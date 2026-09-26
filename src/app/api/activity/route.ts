import { NextResponse } from "next/server";
import { db, dbConfigured, migrate } from "@/lib/db";
import { publicCache } from "@/lib/httpCache";

export const dynamic = "force-dynamic";

/**
 * Recent trades, with nobody's name on them.
 *
 * A market page with no sign of life looks like a market nobody uses, which
 * for a new exchange is both untrue and self-fulfilling. This says the
 * opposite in the plainest way available: somebody bought something, a few
 * minutes ago.
 *
 * Anonymous by construction, not by omission — the query never selects a user
 * id, so there is nothing here to leak by adding a field later. Whose trade
 * it was becomes visible only where its owner has chosen to publish it, which
 * is a separate decision made somewhere else.
 *
 * Cached like any other public read: everyone sees the same feed, so one
 * request an interval serves all of them.
 */
export async function GET() {
  if (!dbConfigured) return NextResponse.json({ ok: true, trades: [] });
  try {
    await migrate();
    const rows = await db()<{ side: string; symbol: string; qty: string; at: string }[]>`
      select side, symbol, qty::text, settled_at as at
        from capx.orders
       where status = 'settled' and settled_at is not null
       order by settled_at desc
       limit 12`;

    return NextResponse.json({
      ok: true,
      trades: rows.map((r) => ({
        side: r.side === "sell" ? "sell" : "buy",
        symbol: r.symbol,
        qty: Number(r.qty),
        at: r.at,
      })),
    }, { headers: publicCache(20) });
  } catch {
    // A quiet strip is a fine failure: it is decoration around the prices,
    // and the prices are what the page is for.
    return NextResponse.json({ ok: true, trades: [] }, { headers: publicCache(20) });
  }
}
