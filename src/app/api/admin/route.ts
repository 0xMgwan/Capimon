import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db, migrate, dbConfigured } from "@/lib/db";
import { checkSolvency } from "@/lib/solvency";
import { ntzsTreasury, capabilities, collectionRoute } from "@/lib/omnibus";
import { treasuryAddress, treasuryConfigured, treasuryHoldings } from "@/lib/treasury";
import { ntzsConfigured, getSwapRate } from "@/lib/ntzs";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

/**
 * Operations view. Token-gated: this exposes every customer's deposits, so it
 * must never be reachable by guessing a URL.
 */
function authorised(req: Request) {
  if (!ADMIN_TOKEN) return false;
  const url = new URL(req.url);
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
    || url.searchParams.get("token") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  if (!authorised(req)) {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }

  try {
    await migrate();
    const sql = db();

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
      sql`select o.id::text, o.side, o.symbol, o.usdc_amount::text, o.qty::text, o.status,
                 o.tx_hash, o.error, o.created_at, u.email
            from capx.orders o join capx.users u on u.id = o.user_id
           order by o.created_at desc limit 50`,
      sql<{ users: number; pending: number; settled_tzs: string | null; credited_usdc: string | null; settled_orders: number; failed_orders: number }[]>`
        select (select count(*) from capx.users)::int as users,
               (select count(*) from capx.deposits where status in ('pending','uncertain'))::int as pending,
               (select coalesce(sum(amount_tzs),0) from capx.deposits where status = 'settled')::text as settled_tzs,
               (select coalesce(sum(usdc_credited),0) from capx.deposits where status = 'settled')::text as credited_usdc,
               (select count(*) from capx.orders where status = 'settled')::int as settled_orders,
               (select count(*) from capx.orders where status = 'failed')::int as failed_orders`,

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
           where l.kind = 'withdrawal' order by l.id desc limit 30`,
    ]);

    // Reported separately: an unreachable dependency is not a shortfall.
    const [solvency, ntzs, onchain, caps, route] = await Promise.all([
      treasuryConfigured ? checkSolvency().catch(() => null) : null,
      ntzsConfigured ? ntzsTreasury().catch(() => null) : null,
      treasuryConfigured ? treasuryHoldings().catch(() => null) : null,
      ntzsConfigured ? capabilities().catch(() => null) : null,
      ntzsConfigured ? collectionRoute().catch(() => null) : null,
    ]);

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
      },
      solvency,
      // The two sides of custody: shillings held at nTZS, shares and USDC held onchain.
      ntzs,
      onchain,
      capabilities: caps,
      collectionRoute: route,
      treasury: treasuryAddress(),
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
  if (!authorised(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

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
    if (body.action === "reconcile-swap-drift") {
      const solvency = await checkSolvency();
      const tzs = solvency.assets.find((a) => a.asset === "TZS");
      const drift = tzs ? tzs.owed - tzs.held : 0;
      if (!(drift > 1)) {
        return NextResponse.json({ ok: true, applied: false, reason: "No shilling drift to reconcile." });
      }

      await migrate();
      const sql = db();
      const candidates = await sql<{ id: string; user_id: string }[]>`
        select o.id::text, o.user_id::text
          from capx.orders o
         where o.side = 'buy' and o.status = 'failed' and o.usdc_amount is null
           and not exists (
             select 1 from capx.ledger_entries l where l.ref = o.id::text || ':unwind-tzs')
         order by o.created_at desc
         limit 1`;
      if (!candidates.length) {
        return NextResponse.json({
          ok: false, code: "unattributed",
          error: `A ${Math.round(drift).toLocaleString()} TZS shortfall exists but no failed shilling order ` +
                 `explains it. Reconcile it explicitly with userId/asset/amount rather than guessing.`,
        }, { status: 409 });
      }

      const { id: orderId, user_id } = candidates[0];
      // Value the converted shillings at the live rate — that is what the swap
      // actually produced, and what the customer should now hold.
      const r = await getSwapRate("NTZS", "USDC", Math.max(1000, Math.round(drift)));
      const usdc = Number(r.expectedOutput ?? 0);
      if (!(usdc > 0)) {
        return NextResponse.json({ ok: false, code: "rate_unavailable",
          error: "No shilling rate is available to value the correction." }, { status: 503 });
      }

      const { record } = await import("@/lib/ledger");
      const result = await record([
        { userId: user_id, kind: "adjustment", asset: "TZS", amount: (-drift).toString(),
          ref: `${orderId}:unwind-tzs`,
          metadata: { orderId, reason: "order failed after the shilling swap" } },
        { userId: user_id, kind: "adjustment", asset: "USDC", amount: usdc.toString(),
          ref: `${orderId}:unwind-usdc`,
          metadata: { orderId, reason: "shillings already converted; held as USDC" } },
      ]);

      return NextResponse.json({
        ok: true, applied: !result.duplicate, orderId, userId: user_id,
        movedTzs: Math.round(drift), creditedUsdc: Number(usdc.toFixed(6)),
      }, { headers: { "cache-control": "no-store" } });
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
