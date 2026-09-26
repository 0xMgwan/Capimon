import { NextResponse } from "next/server";
import { db, dbConfigured, migrate } from "@/lib/db";
import { publicCache } from "@/lib/httpCache";

export const dynamic = "force-dynamic";

/**
 * Recent trades, named only where their owner said so.
 *
 * A market page with no sign of life looks like a market nobody uses, which
 * for a new exchange is both untrue and self-fulfilling. This says the
 * opposite in the plainest way available: somebody bought something, a few
 * minutes ago.
 *
 * Whose trade it was is the account's own decision, and it is made in the
 * query rather than in the page. A handle appears here only for an account
 * that switched its trading on; for everyone else the username column comes
 * back null, so a future field cannot leak a name that was never selected.
 * The trade itself is public either way — that a share changed hands is a
 * fact about the market, not about a person.
 *
 * Cached like any other public read: everyone sees the same feed, so one
 * request an interval serves all of them. That cache is also why the two
 * cases must be settled in SQL — a page cannot re-decide per viewer what a
 * shared response already contains.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: true, trades: [] });
  try {
    await migrate();
    /*
     * One security, or the whole market.
     *
     * A detail page showing trades in other companies is noise next to its
     * own price; the markets list wants the opposite. Same query, one filter.
     */
    const symbol = new URL(req.url).searchParams.get("symbol")?.toUpperCase() ?? null;
    const sql = db();
    const rows = await sql<{ side: string; symbol: string; qty: string; at: string;
                             username: string | null }[]>`
      select o.side, o.symbol, o.qty::text, o.settled_at as at,
             case when u.share_activity then u.username else null end as username
        from capx.orders o
        join capx.users u on u.id = o.user_id
       where o.status = 'settled' and o.settled_at is not null
         ${symbol ? sql`and o.symbol = ${symbol}` : sql``}
       order by o.settled_at desc
       limit 12`;

    return NextResponse.json({
      ok: true,
      trades: rows.map((r) => ({
        side: r.side === "sell" ? "sell" : "buy",
        symbol: r.symbol,
        qty: Number(r.qty),
        at: r.at,
        who: r.username,
      })),
    }, { headers: publicCache(20) });
  } catch {
    // A quiet strip is a fine failure: it is decoration around the prices,
    // and the prices are what the page is for.
    return NextResponse.json({ ok: true, trades: [] }, { headers: publicCache(20) });
  }
}
