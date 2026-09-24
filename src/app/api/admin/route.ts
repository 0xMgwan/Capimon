import { NextResponse } from "next/server";
import { db, migrate, dbConfigured } from "@/lib/db";
import { checkSolvency } from "@/lib/solvency";
import { ntzsTreasury, capabilities, collectionRoute } from "@/lib/omnibus";
import { treasuryAddress, treasuryConfigured, treasuryHoldings } from "@/lib/treasury";
import { ntzsConfigured } from "@/lib/ntzs";
import { roleOf } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
// The bank probe walks forty-odd candidates, spaced under nTZS's rate limit.
export const maxDuration = 300;

/**
 * Operations view. Token-gated: this exposes every customer's deposits, so it
 * must never be reachable by guessing a URL.
 *
 * FIMCO's token reaches the client-facing half — who the customers are, what
 * they traded, what they withdrew — because a broker of record keeps those.
 * CAPX's own books, its treasury, solvency, deposit reconciliation and nTZS
 * capabilities, stay with CAPX.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  const role = roleOf(req);
  if (!role) {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }

  try {
    await migrate();
    const sql = db();

    const jobs = await import("@/lib/jobRuns").then((m) => m.recentRuns()).catch(() => []);

    const [deposits, users, orders, totals, holdingsByAsset, ledgerTotals, withdrawals] = await Promise.all([
      // Everything needed to match a CAPX row against its nTZS counterpart,
      // plus the identity CAPX holds for the depositor.
      sql`select d.id::text, d.amount_tzs, d.status, d.usdc_credited::text, d.phone,
                 d.error, d.created_at, d.settled_at,
                 d.ntzs_deposit_id, d.ntzs_status, d.ntzs_reference,
                 d.swap_ref, d.transfer_tx, d.rate_tzs_usdc::text, d.metadata,
                 u.id::text as user_id, u.email, u.name, u.nida_number, u.phone as account_phone
            from capx.deposits d join capx.users u on u.id = d.user_id
           order by d.created_at desc limit 100`,
      sql`select id::text, email, name, phone, nida_number, kyc_status, created_at,
                 (select count(*) from capx.deposits d where d.user_id = u.id)::int as deposits,
                 (select coalesce(sum(amount_tzs),0) from capx.deposits d
                   where d.user_id = u.id and d.status = 'settled')::int as settled_tzs,
                 (select coalesce(sum(amount),0)::text from capx.ledger_entries l
                   where l.user_id = u.id and l.asset = 'USDC') as usdc_balance
            from capx.users u order by created_at desc limit 100`,
      sql`select o.id::text, o.side, o.symbol, o.usdc_amount::text, o.qty::text, o.price::text, o.status,
                 o.tx_hash, o.error, o.created_at, u.email
            from capx.orders o join capx.users u on u.id = o.user_id
           order by o.created_at desc limit 50`,
      sql<{ users: number; pending: number; settled_tzs: string | null; credited_usdc: string | null;
            settled_orders: number; failed_orders: number; fees_tzs: string | null }[]>`
        select (select count(*) from capx.users)::int as users,
               (select count(*) from capx.deposits where status in ('pending','uncertain'))::int as pending,
               (select coalesce(sum(amount_tzs),0) from capx.deposits where status = 'settled')::text as settled_tzs,
               (select coalesce(sum(usdc_credited),0) from capx.deposits where status = 'settled')::text as credited_usdc,
               (select count(*) from capx.orders where status = 'settled')::int as settled_orders,
               (select count(*) from capx.orders where status = 'failed')::int as failed_orders,
               /*
                * Fees taken on shilling trades.
                *
                * These are not swept anywhere — they are deducted from what a
                * customer's shillings buy and stay in the omnibus, so they show
                * as TZS surplus against client liabilities and nowhere else.
                * Summed from the entry that charged them so the figure comes
                * from the trades themselves rather than a second tally that
                * could drift from them.
                */
               (select coalesce(sum((metadata->>'fee')::numeric), 0)
                  from capx.ledger_entries
                 where asset = 'TZS' and metadata ? 'fee')::text as fees_tzs`,

      // Shares owed to clients, aggregated per asset.
      sql`select asset, sum(amount)::text as qty, count(distinct user_id)::int as holders
            from capx.ledger_entries
           where asset <> 'USDC' and asset <> 'TZS'
           group by asset having sum(amount) <> 0
           order by asset`,

      sql`select asset, sum(amount)::text as total, count(*)::int as entries
            from capx.ledger_entries group by asset order by asset`,

      sql`select l.id::text, l.amount::text, l.ref, l.created_at, u.email
            from capx.ledger_entries l join capx.users u on u.id = l.user_id
           where l.kind = 'withdrawal' order by l.created_at desc, l.id desc limit 30`,
    ]);

    /*
     * FIMCO sees the client-facing half and nothing else: who the customers
     * are, what they traded, what they withdrew. CAPX's treasury, solvency,
     * deposit reconciliation and nTZS capabilities are not a broker's records.
     */
    if (role === "fimco") {
      return NextResponse.json(
        { ok: true, role, users, orders, withdrawals },
        { headers: { "cache-control": "no-store" } },
      );
    }

    // Reported separately: an unreachable dependency is not a shortfall.
    const [solvency, ntzs, onchain, caps, route, feePos, sweeps] = await Promise.all([
      treasuryConfigured ? checkSolvency().catch(() => null) : null,
      ntzsConfigured ? ntzsTreasury().catch(() => null) : null,
      treasuryConfigured ? treasuryHoldings().catch(() => null) : null,
      ntzsConfigured ? capabilities().catch(() => null) : null,
      ntzsConfigured ? collectionRoute().catch(() => null) : null,
      import("@/lib/feeSweep").then((m) => m.feePosition()).catch(() => null),
      import("@/lib/feeSweep").then((m) => m.recentSweeps(10)).catch(() => []),
    ]);
    const fees = { position: feePos, sweeps };

    return NextResponse.json({
      ok: true,
      // Does the sum of credited deposits reconcile with what the ledger holds?
      reconciliation: await sql<{ credited: string | null; ledger: string | null; deposits: number }[]>`
        select (select coalesce(sum(usdc_credited),0)::text from capx.deposits where status = 'settled') as credited,
               (select coalesce(sum(amount),0)::text from capx.ledger_entries
                 where asset = 'USDC' and kind = 'deposit') as ledger,
               (select count(*)::int from capx.deposits where status = 'settled') as deposits`,
      totals: {
        users: totals[0]?.users ?? 0,
        pendingDeposits: totals[0]?.pending ?? 0,
        settledTzs: Number(totals[0]?.settled_tzs ?? 0),
        creditedUsdc: Number(totals[0]?.credited_usdc ?? 0),
      },
      totalsExtra: {
        settledOrders: totals[0]?.settled_orders ?? 0,
        failedOrders: totals[0]?.failed_orders ?? 0,
        feesTzs: Number(totals[0]?.fees_tzs ?? 0),
      },
      fees,
      solvency,
      // The two sides of custody: shillings held at nTZS, shares and USDC held onchain.
      ntzs,
      onchain,
      capabilities: caps,
      collectionRoute: route,
      treasury: treasuryAddress(),
      jobs,
      holdingsByAsset, ledgerTotals, withdrawals,
      deposits, users, orders,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "admin query failed" },
      { status: 500 },
    );
  }
}

/**
 * Records a ledger adjustment: a manual correction, always with a reason.
 *
 * The one case that needs it is reconciliation — an earlier credit that does
 * not match what actually arrived. The ledger is append-only, so a correction
 * is another entry, not an edit, and it carries a unique ref so re-running the
 * same fix is a no-op rather than a double correction.
 */
export async function POST(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  // Corrections rewrite the ledger, so they stay CAPX's alone.
  if (roleOf(req) !== "admin") return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));

    /*
     * Reconcile shillings that a failed order already converted.
     *
     * A buy swaps TZS to USDC before it trades. If the trade then fails the
     * swap cannot be undone, so the ledger keeps claiming shillings the omnibus
     * no longer holds — an unbacked liability that pauses trading. Newer orders
     * unwind themselves; this repairs rows written before that existed.
     *
     * The correction is derived, never typed: the shortfall comes from the
     * solvency check and the account from the failed order that caused it, so
     * an operator cannot fat-finger a balance. Idempotent on the order id.
     */
    /*
     * Move accrued trade fees out of the customer float.
     *
     * The amount is never taken from the request — it is the difference between
     * what the trades charged and what has already been moved, so an operator
     * cannot sweep a number they typed. The destination is an env var for the
     * same reason.
     */
    /*
     * Asks nTZS which bank codes it knows.
     *
     * Slow on purpose — one quote per candidate, spaced under their rate
     * limit — and it moves no money: a quote prices a payout and nothing
     * else. Only the codes the rail recognised are saved.
     */
    /*
     * Runs the hourly job now.
     *
     * The scheduler is a promise made by the host, and when a standing order
     * does not execute the first question is whether it ever ran. This makes
     * that answerable from the desk rather than from a support ticket — it
     * does exactly what the cron does, including deciding by the clock which
     * of its pieces are due.
     */
    /*
     * Sends the portfolio summary now.
     *
     * It otherwise happens twice a day at fixed hours, which is a long wait
     * to find out whether push works at all. The slot follows the clock, so
     * what arrives is exactly what would have arrived on its own.
     */
    if (body.action === "send-digest") {
      const { pushConfigured } = await import("@/lib/push");
      if (!pushConfigured) {
        return NextResponse.json(
          { ok: false, error: "Push is not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY." },
          { status: 503 });
      }
      const { sendDigest } = await import("@/lib/digest");
      const hour = Number(new Date().toLocaleString("en-GB", {
        timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", hour12: false,
      }));
      const r = await sendDigest(hour < 12 ? "morning" : "evening");
      return NextResponse.json({ ok: true, ...r });
    }

    if (body.action === "run-tick") {
      const url = new URL(req.url);
      const r = await fetch(`${url.origin}/api/cron/tick`, {
        headers: { authorization: req.headers.get("authorization") ?? "" },
      });
      return NextResponse.json({ ok: r.ok, ...(await r.json().catch(() => ({}))) });
    }

    if (body.action === "probe-banks") {
      const { probeBankCodes, saveVerifiedBanks, TOTAL_CANDIDATES } = await import("@/lib/bankProbe");
      const offset = Math.max(0, Number(body.offset) || 0);
      // Ten at roughly a second each: comfortably inside a request, and the
      // desk sees progress instead of a spinner that never resolves.
      const size = 10;
      const results = await probeBankCodes(offset, size);
      const saved = await saveVerifiedBanks(results, offset > 0);
      const next = offset + size;
      return NextResponse.json({
        ok: true, saved, offset, total: TOTAL_CANDIDATES,
        next: next < TOTAL_CANDIDATES ? next : null,
        known: results.filter((r) => r.verdict === "known").map((r) => r.code),
        unclear: results.filter((r) => r.verdict === "unclear").map((r) => ({ code: r.code, detail: r.detail })),
        rejected: results.filter((r) => r.verdict === "unknown").length,
      });
    }

    if (body.action === "sweep-fees") {
      const { sweepFees, sweepBrokerFees, feePosition } = await import("@/lib/feeSweep");
      try {
        const { id, amount, txHash } = await sweepFees({ force: body.force === true });
        /*
         * The broker's share moves in the same action, to its own account.
         * After CAPX's leg, and never able to fail it: a broker account that
         * is not set up yet leaves their fees where they already were.
         */
        const broker = await sweepBrokerFees().catch(() => ({ ok: false as const, reason: "failed" }));
        return NextResponse.json({ ok: true, id, amount, txHash, broker, position: await feePosition() });
      } catch (e) {
        return NextResponse.json(
          { ok: false, error: e instanceof Error ? e.message : "sweep failed",
            position: await feePosition() },
          { status: 409 },
        );
      }
    }

    if (body.action === "reconcile-shortfall") {
      const { reconcileSwapDrift, reconcileShortfall } = await import("@/lib/reconcile");
      // The precise repair first — an interrupted order explains itself — then
      // the measured write-down for anything it does not account for.
      const drift = await reconcileSwapDrift();
      const rest = await reconcileShortfall();
      return NextResponse.json({ ok: true, drift, ...rest }, { headers: { "cache-control": "no-store" } });
    }

    if (body.action === "reconcile-swap-drift") {
      const { reconcileSwapDrift } = await import("@/lib/reconcile");
      const r = await reconcileSwapDrift();
      return NextResponse.json({ ok: true, ...r }, { headers: { "cache-control": "no-store" } });
    }

    const userId = String(body.userId ?? "");
    const rawAsset = String(body.asset ?? "").trim();
    const amount = Number(body.amount);
    const reason = String(body.reason ?? "").trim();

    // Resolve to the ledger's exact symbol. Share symbols are mixed-case
    // ("NVDAc"), so uppercasing would create a second, phantom asset the
    // solvency check and the portfolio would never reconcile against.
    const { BY_SYMBOL } = await import("@/lib/assets");
    const upper = rawAsset.toUpperCase();
    const asset =
      upper === "USDC" || upper === "TZS" ? upper
      : BY_SYMBOL[rawAsset.toLowerCase()]?.symbol ?? "";

    const ref = String(body.ref ?? "").trim() || `adjust:${userId}:${asset}:${reason}`;

    if (!userId || !asset || !Number.isFinite(amount) || amount === 0 || !reason) {
      return NextResponse.json(
        { ok: false, code: "bad_request",
          error: rawAsset && !asset
            ? `Unknown asset "${rawAsset}". Use USDC, TZS, or a listed share symbol.`
            : "userId, asset, a non-zero amount and a reason are all required." },
        { status: 400 });
    }

    const { record } = await import("@/lib/ledger");
    const result = await record([
      { userId, kind: "adjustment", asset, amount: amount.toString(), ref,
        metadata: { reason, by: "admin" } },
    ]);

    const { balanceOf } = await import("@/lib/ledger");
    const balance = await balanceOf(userId, asset);
    return NextResponse.json(
      { ok: true, applied: !result.duplicate, duplicate: result.duplicate, ref, balance },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "adjustment failed" },
      { status: 500 });
  }
}
