import { NextResponse } from "next/server";
import { dseHistory } from "@/lib/dse";
import { dseSecurity } from "@/lib/dseSecurities";
import { db, dbConfigured, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A DSE security's closing prices, one point per session the exchange printed. */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sec = await dseSecurity(symbol);
  if (!sec) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
  let candles = await dseHistory(sec.symbol, 365).catch(() => []);
  let cachedAt: string | null = null;
  /*
   * Kept on success, served on failure.
   *
   * A chart that goes blank whenever the exchange's server does reads as our
   * fault. The last good series is still true up to its date, so it is shown,
   * with when it was fetched.
   */
  if (dbConfigured) {
    try {
      await migrate();
      if (candles.length > 1) {
        await db()`
          insert into capx.price_history_cache (symbol, candles, fetched_at)
          values (${sec.symbol}, ${db().json(JSON.parse(JSON.stringify(candles)))}, now())
          on conflict (symbol) do update set candles = excluded.candles, fetched_at = now()`;
      } else {
        const [row] = await db()<{ candles: typeof candles; fetched_at: string }[]>`
          select candles, fetched_at from capx.price_history_cache where symbol = ${sec.symbol}`;
        if (row) { candles = row.candles; cachedAt = new Date(row.fetched_at).toISOString(); }
      }
    } catch { /* no cache is no worse than before */ }
  }
  return NextResponse.json(
    { ok: true, candles, cachedAt },
    // A session's close does not change once printed, so this can be cached
    // for a good while; the window is short enough to pick up today's.
    { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
