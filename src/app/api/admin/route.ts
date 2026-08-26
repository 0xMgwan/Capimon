import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db, migrate, dbConfigured } from "@/lib/db";
import { checkSolvency } from "@/lib/solvency";
import { ntzsTreasury, capabilities, collectionRoute } from "@/lib/omnibus";
import { treasuryAddress, treasuryConfigured, treasuryHoldings } from "@/lib/treasury";
import { ntzsConfigured } from "@/lib/ntzs";

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
