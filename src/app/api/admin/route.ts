import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db, migrate, dbConfigured } from "@/lib/db";
import { checkSolvency } from "@/lib/solvency";
import { omnibusBalances } from "@/lib/omnibus";
import { treasuryAddress, treasuryConfigured } from "@/lib/treasury";
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

    const [deposits, users, orders, totals] = await Promise.all([
      sql`select d.id::text, d.amount_tzs, d.status, d.usdc_credited::text, d.phone,
                 d.error, d.created_at, d.settled_at, u.email
            from capx.deposits d join capx.users u on u.id = d.user_id
           order by d.created_at desc limit 100`,
      sql`select id::text, email, name, phone, kyc_status, created_at,
                 (select count(*) from capx.deposits d where d.user_id = u.id)::int as deposits
            from capx.users u order by created_at desc limit 100`,
      sql`select o.id::text, o.side, o.symbol, o.usdc_amount::text, o.qty::text, o.status,
                 o.tx_hash, o.error, o.created_at, u.email
            from capx.orders o join capx.users u on u.id = o.user_id
           order by o.created_at desc limit 50`,
      sql<{ users: number; pending: number; settled_tzs: string | null; credited_usdc: string | null }[]>`
        select (select count(*) from capx.users)::int as users,
               (select count(*) from capx.deposits where status in ('pending','uncertain'))::int as pending,
               (select sum(amount_tzs) from capx.deposits where status = 'settled')::text as settled_tzs,
               (select sum(usdc_credited) from capx.deposits where status = 'settled')::text as credited_usdc`,
    ]);

    // Reported separately: an unreachable dependency is not a shortfall.
    const solvency = treasuryConfigured ? await checkSolvency().catch(() => null) : null;
    const omnibus = ntzsConfigured ? await omnibusBalances().catch(() => null) : null;

    return NextResponse.json({
      ok: true,
      totals: {
        users: totals[0]?.users ?? 0,
        pendingDeposits: totals[0]?.pending ?? 0,
        settledTzs: Number(totals[0]?.settled_tzs ?? 0),
        creditedUsdc: Number(totals[0]?.credited_usdc ?? 0),
      },
      solvency,
      omnibus,
      treasury: treasuryAddress(),
      deposits, users, orders,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "admin query failed" },
      { status: 500 },
    );
  }
}
