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

    const [deposits, users, rawOrders, totals, holdingsByAsset, ledgerTotals, withdrawals] = await Promise.all([
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
                   where l.user_id = u.id and l.asset = 'USDC') as usdc_balance,
                 /*
                  * The shilling balance, which for most customers is the
                  * whole of it.
                  *
                  * The column said "balance" and summed USDC alone, so an
                  * account that had deposited five thousand shillings and
                  * still held them read as eight cents — the eight cents
                  * being whatever dust was left in the other currency. Both
                  * are reported now and the desk adds them up.
                  */
                 (select coalesce(sum(amount),0)::text from capx.ledger_entries l
                   where l.user_id = u.id and l.asset = 'TZS') as tzs_balance,
                 /* Shares, at cost, so a zero cash balance is not mistaken
                    for an empty account. */
                 (select count(*) from capx.ledger_entries l
                   where l.user_id = u.id and l.asset not in ('TZS','USDC')
                     and l.amount > 0)::int as share_entries
            from capx.users u order by created_at desc limit 100`,
      /* The cash leg and the settlement time come along so the desk can see
         the same contract-note reference the customer and DSE are quoting.
         Recomputed here rather than stored, because a reference read from a
         column would agree with a row that had been edited. */
      sql`select o.id::text, o.side, o.symbol, o.usdc_amount::text, o.qty::text, o.price::text,
                 o.status, o.tx_hash, o.error, o.created_at, o.settled_at, u.email,
                 (select abs(l.amount)::text from capx.ledger_entries l
                   where l.ref = o.id::text || ':cash' and l.asset = 'TZS' limit 1) as cash
            from capx.orders o join capx.users u on u.id = o.user_id
           order by o.created_at desc limit 50`,
      sql<{ users: number; pending: number; settled_tzs: string | null; credited_usdc: string | null;
            settled_orders: number; failed_orders: number; fees_tzs: string | null;
            volume_tzs: string | null; volume_usdc: string | null;
            volume_otc_usdc: string | null; otc_orders: number }[]>`
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
                 where asset = 'TZS' and metadata ? 'fee')::text as fees_tzs,
               /*
                * Everything CAPX has actually traded, both sides.
                *
                * Volume is the cash leg of every settled order, and a sell
                * counts as much as a buy — it is business done either way,
                * and netting them would report a customer who bought and
                * sold the same share as having done nothing.
                *
                * Kept in the two currencies the trades happened in rather
                * than converted into one. A shilling total run through
                * today's rate would restate last month's trades at this
                * morning's price, which is a number that changes while
                * nobody trades.
                */
               (select coalesce(sum(abs(amount)), 0)
                  from capx.ledger_entries
                 where asset = 'TZS' and kind in ('buy','sell'))::text as volume_tzs,
               (select coalesce(sum(abs(amount)), 0)
                  from capx.ledger_entries
                 where asset = 'USDC' and kind in ('buy','sell'))::text as volume_usdc,
               /* Self-custody sales sit in their own table and are trades
                  like any other. */
               (select coalesce(sum(net_usdc), 0)
                  from capx.otc_orders where status = 'settled')::text as volume_otc_usdc,
               (select count(*) from capx.otc_orders where status = 'settled')::int as otc_orders`,

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
     * Every order with the reference it is quoted by.
     *
     * A shilling-settled trade has no transaction hash and never will, so
     * the desk's Tx column was a dash on exactly the orders somebody is most
     * likely to be ringing up about. The reference is what the customer sees,
     * what DSE sees and what the day's anchor hashes, so support searching
     * for it has to find it here too.
     */
    const { dealRef } = await import("@/lib/dseAnchor");
    const orders = (rawOrders as unknown as {
      id: string; side: string; symbol: string; qty: string | null; price: string | null;
      cash: string | null; status: string; created_at: unknown; settled_at: unknown;
    }[]).map((o) => ({ ...o, reference: dealRef(o) }));


    /*
     * FIMCO sees the client-facing half and nothing else: who the customers
     * are, what they traded, what they withdrew. CAPX's treasury, solvency,
     * deposit reconciliation and nTZS capabilities are not a broker's records.
     */
    if (role === "fimco") {
      /*
       * The broker sees the redemption figure too, and should.
       *
       * It is the one number that says what CAPX may have to ask them for:
       * if every holder sold at today's marks, this is the shilling bill,
       * and the part of it that is unrealised gain is the part that can only
       * be met by selling the underlying on the exchange. FIMCO is who does
       * that selling, so a figure they cannot see is a call they cannot be
       * ready for. It carries no customer's position — only the totals.
       */
      return NextResponse.json(
        {
          ok: true, role, users, orders, withdrawals,
          redemption: await import("@/lib/redemption")
            .then((m) => m.redemptionExposure()).catch(() => null),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    // Reported separately: an unreachable dependency is not a shortfall.
    const [solvency, ntzs, onchain, caps, route, feePos, sweeps, redemption, flow,
           dseDepth] = await Promise.all([
      treasuryConfigured ? checkSolvency().catch(() => null) : null,
      ntzsConfigured ? ntzsTreasury().catch(() => null) : null,
      treasuryConfigured ? treasuryHoldings({ prices: true }).catch(() => null) : null,
      ntzsConfigured ? capabilities().catch(() => null) : null,
      ntzsConfigured ? collectionRoute().catch(() => null) : null,
      import("@/lib/feeSweep").then((m) => m.feePosition()).catch(() => null),
      import("@/lib/feeSweep").then((m) => m.recentSweeps(10)).catch(() => []),
      /* What a full redemption would ask for in shillings, against what is
         on hand to pay it. Solvency answers the share question; this is the
         cash one. */
      import("@/lib/redemption").then((m) => m.redemptionExposure()).catch(() => null),
      /* What actually moves the float, day by day — the number that sizes a
         facility, as distinct from the stress figure above it. */
      import("@/lib/netFlow").then((m) => m.netFlow(30)).catch(() => null),
      /*
       * How long selling the underlying would actually take.
       *
       * Every figure above is measured against the oracle mark, and this is
       * the one that says whether that mark is a price the book could be sold
       * at. depth.ts asks the US market the same question by quoting it; the
       * DSE has nothing to quote, so this reads what it published.
       */
      import("@/lib/dseDepth").then((m) => m.dseLiquidity()).catch(() => null),
    ]);

    /*
     * Who is waiting to be paid, and what the standing bid can cover.
     *
     * These belong next to each other: a queue with capacity behind it drains
     * on the next tick and needs nobody; a queue with none is a person waiting
     * on a decision only CAPX can make.
     */
    const [queue, facility] = await Promise.all([
      sql<{ waiting: number; owed: string; oldest: string | null; failed: number }[]>`
        select count(*) filter (where status = 'queued')::int as waiting,
               coalesce(sum(amount_tzs) filter (where status = 'queued'), 0)::text as owed,
               min(created_at) filter (where status = 'queued')::text as oldest,
               count(*) filter (where status = 'failed')::int as failed
          from capx.withdrawal_queue`.catch(() => []),
      import("@/lib/liquidity").then(async (m) => {
        const list = await m.providers();
        const rows = await Promise.all(list.map(async (p) => ({
          name: p.name, active: p.active, committedTzs: p.committedTzs,
          ...(await m.capacityOf(p)),
        })));
        return {
          providers: rows,
          availableTzs: rows.reduce((t, r) => t + r.availableTzs, 0),
        };
      }).catch(() => null),
    ]);

    /*
     * Whether the facility is sized for the book, as distinct from whether
     * each provider is inside their own terms.
     *
     * Composed here from two figures already fetched rather than read again:
     * capacityOf is several ledger and oracle reads per provider, and the
     * redemption exposure is a pass over the whole book. The arithmetic is
     * the part worth having in one place, so it is a pure function in
     * lib/liquidity.ts and this is its only caller.
     */
    const { facilitySizingFrom } = await import("@/lib/liquidity");
    const sizing = redemption && facility
      ? facilitySizingFrom({
          requiredTzs: redemption.shortfallTzs,
          unrealisedTzs: redemption.unrealisedTzs,
          providers: facility.providers,
        })
      : null;
    const fees = { position: feePos, sweeps };

    /*
     * Whether the daily anchors are going out, and whether they still agree.
     *
     * This is on the desk's page and not only on DSE's because the order the
     * two should learn it in is not negotiable. A cron that has quietly
     * stopped posting, or a day whose root no longer re-derives, is something
     * CAPX needs to find on its own screen — being told about it by the
     * exchange is the same fact arriving in the worst possible way.
     */
    const anchorHealth = await import("@/lib/dseAnchor")
      .then(async (m) => {
        const rows = await m.anchors(14);
        return {
          days: rows.length,
          posted: rows.filter((a) => a.status === "posted").length,
          failed: rows.filter((a) => a.status === "failed").length,
          pending: rows.filter((a) => a.status === "pending").length,
          mismatched: rows.filter((a) => a.status === "posted" && !a.matches).map((a) => a.day),
          latest: rows[0] ?? null,
        };
      })
      .catch(() => null);

    return NextResponse.json({
      ok: true,
      // Does the sum of credited deposits reconcile with what the ledger holds?
      reconciliation: await sql<{ credited: string | null; ledger: string | null; deposits: number }[]>`
        select (select coalesce(sum(usdc_credited),0)::text from capx.deposits where status = 'settled') as credited,
               (select coalesce(sum(amount),0)::text from capx.ledger_entries
                 where asset = 'USDC' and kind = 'deposit') as ledger,
               (select count(*)::int from capx.deposits where status = 'settled') as deposits`,
      redemption,
      flow,
      dseDepth,
      sizing,
      queue: queue[0]
        ? { waiting: queue[0].waiting, owedTzs: Number(queue[0].owed),
            oldest: queue[0].oldest, failed: queue[0].failed }
        : null,
      facility,
      totals: {
        users: totals[0]?.users ?? 0,
        pendingDeposits: totals[0]?.pending ?? 0,
        settledTzs: Number(totals[0]?.settled_tzs ?? 0),
        creditedUsdc: Number(totals[0]?.credited_usdc ?? 0),
        volumeTzs: Number(totals[0]?.volume_tzs ?? 0),
        volumeUsdc: Number(totals[0]?.volume_usdc ?? 0),
        volumeOtcUsdc: Number(totals[0]?.volume_otc_usdc ?? 0),
        otcOrders: totals[0]?.otc_orders ?? 0,
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
      anchors: anchorHealth,
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
