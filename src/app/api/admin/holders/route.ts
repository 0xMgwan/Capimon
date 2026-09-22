import { NextResponse } from "next/server";
import { db, migrate, dbConfigured } from "@/lib/db";
import { roleOf } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

type Row = {
  user_id: string; email: string; name: string | null; username: string | null;
  kyc_status: string; asset: string; qty: string;
  first_bought: string | null; last_trade: string | null;
  bought: string; sold: string; trades: number;
};

/**
 * Every position, per holder.
 *
 * Built from the ledger rather than a positions table, because the ledger is
 * the record and anything else would be a second copy of it that could drift.
 * Cost is worked out the same way the customer's own page does — average cost
 * replayed over the entries — so an operator and a customer looking at the same
 * position see the same number rather than two figures that need reconciling.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  const role = roleOf(req);
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  /* FIMCO sees the full register, contact details included: as broker of
     record it keeps the beneficial-owner records compliance requires. */

  try {
    await migrate();
    const sql = db();

    const rows = await sql<Row[]>`
      select u.id::text as user_id, u.email, u.name, u.username, u.kyc_status,
             l.asset,
             sum(l.amount)::text as qty,
             min(l.created_at) filter (where l.amount > 0) as first_bought,
             max(l.created_at) as last_trade,
             coalesce(sum(l.amount) filter (where l.amount > 0), 0)::text as bought,
             coalesce(-sum(l.amount) filter (where l.amount < 0), 0)::text as sold,
             count(*)::int as trades
        from capx.ledger_entries l
        join capx.users u on u.id = l.user_id
       where l.asset <> 'USDC' and l.asset <> 'TZS'
       group by u.id, u.email, u.name, u.username, u.kyc_status, l.asset
      having sum(l.amount) <> 0
       order by l.asset, sum(l.amount) desc`;

    /*
     * Cost per holder and asset, replayed from the same entries.
     *
     * Done here rather than in SQL because average cost is path dependent: a
     * sell removes basis at the average of the moment, and that cannot be
     * expressed as a sum over rows.
     */
    const { positionCosts } = await import("@/lib/pnl");
    const byUser = new Map<string, Awaited<ReturnType<typeof positionCosts>>>();
    for (const id of new Set(rows.map((r) => r.user_id))) {
      byUser.set(id, await positionCosts(id).catch(() => new Map()));
    }

    const holders = rows.map((r) => {
      const cost = byUser.get(r.user_id)?.get(r.asset);
      return {
        userId: r.user_id,
        email: r.email,
        name: r.name,
        username: r.username,
        kycStatus: r.kyc_status,
        asset: r.asset,
        qty: Number(r.qty),
        bought: Number(r.bought),
        sold: Number(r.sold),
        trades: r.trades,
        firstBought: r.first_bought,
        lastTrade: r.last_trade,
        avgCost: cost?.avgCost ?? 0,
        costBasis: cost?.costBasis ?? 0,
        realised: cost?.realised ?? 0,
        // Whichever currency it was bought in, so a shilling position is not
        // reported at a dollar figure nobody paid.
        currency: cost?.currency ?? "USD",
      };
    });

    return NextResponse.json({ ok: true, holders }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "could not load holders" },
      { status: 500 },
    );
  }
}
