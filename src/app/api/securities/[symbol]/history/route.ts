import { NextResponse } from "next/server";
import { dseHistory } from "@/lib/dse";
import { dseSecurity } from "@/lib/dseSecurities";
import { db, dbConfigured, migrate } from "@/lib/db";
import { after } from "next/server";
import { syncOraclePoints, oracleHistory } from "@/lib/oracleHistory";

export const dynamic = "force-dynamic";
// The background catch-up of oracle events runs after the response.
export const maxDuration = 60;

/** A DSE security's closing prices, one point per session the exchange printed. */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sec = await dseSecurity(symbol);
  if (!sec) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
  let candles = await dseHistory(sec.symbol, 365).catch(() => []);
  let cachedAt: string | null = null;
  let source: "dse" | "saved" | "saved+oracle" | "oracle" = "dse";
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

        /*
         * The oracle's own record, as the last resort and to bring a saved
         * chart up to date. Its published prices are permanent on Base, so
         * this works even when nothing was ever saved from the exchange.
         */
        await syncOraclePoints(12).catch(() => null);
        const ours = await oracleHistory(sec.symbol).catch(() => []);
        const lastT = candles.length ? candles[candles.length - 1].t : 0;
        const newer = ours.filter((p) => p.t > lastT + 3600);
        if (newer.length) {
          candles = [...candles, ...newer];
          source = candles.length === newer.length ? "oracle" : "saved+oracle";
        } else if (row) {
          source = "saved";
        }
      }
    } catch { /* no fallback is no worse than before */ }

    // Keep the oracle history current in the background, so it is complete
    // before the next outage rather than started during it.
    after(() => syncOraclePoints(60).catch(() => null));
  }
  return NextResponse.json(
    { ok: true, candles, cachedAt, source },
    // A session's close does not change once printed, so this can be cached
    // for a good while; the window is short enough to pick up today's.
    // A fallback is still filling in, so it is cached briefly; an exchange
    // series does not change once printed.
    { headers: { "cache-control": source === "dse"
        ? "public, max-age=300, stale-while-revalidate=3600"
        : "public, max-age=30" } },
  );
}
