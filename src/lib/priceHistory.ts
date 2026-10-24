import "server-only";
import { db, dbConfigured, migrate } from "./db";

/**
 * A security's price over time, on either board.
 *
 * The two come from genuinely different places and that is worth knowing
 * rather than hiding. A Dar es Salaam series is what the exchange printed at
 * each session's close, in shillings. A US series is reconstructed from the
 * Chainlink feed's own round history, in dollars, and is total-return — the
 * published price already carries the token's multiplier, so a split or a
 * dividend moves the multiplier and the price together and leaves no step in
 * the line.
 *
 * The DSE side has three sources behind it, in order of preference, because a
 * chart that goes blank whenever the exchange's server does reads as our
 * fault:
 *
 *   1. the exchange, live;
 *   2. the last good series we saved, which is still true up to its date;
 *   3. the oracle's own published rounds, which are permanent on Base and
 *      work even when nothing was ever saved.
 *
 * Callers are told which they got. A series served from cache during an
 * outage is not a lie, but presenting it as live would be.
 */

export type Candle = { t: number; o?: number; h?: number; l?: number; c?: number; p?: number };

export type PriceHistory = {
  symbol: string;
  venue: "DSE" | "US";
  currency: "TZS" | "USD";
  candles: Candle[];
  /** "dse" | "saved" | "saved+oracle" | "oracle" | "chainlink" */
  source: string;
  /** When a saved series was fetched, if that is what this is. */
  cachedAt: string | null;
};

/**
 * One board's worth, chosen by what the symbol actually is.
 *
 * `sync` runs the oracle catch-up inline. The customer-facing route defers it
 * with `after()` so a reader never waits for it; a partner calling an API has
 * no page to render, so it is left to the caller to decide.
 */
export async function priceHistory(
  symbol: string, opts: { days?: number; sync?: boolean } = {},
): Promise<PriceHistory | null> {
  const sym = symbol.trim().toUpperCase();
  const days = Math.min(1825, Math.max(1, opts.days ?? 365));

  /*
   * Decide which board this is from the static registries first.
   *
   * An earlier version asked the DSE lookup and, on null, fell through to the
   * US path — which calls getMarkets and costs thousands of eth_calls at any
   * real depth. So a symbol that was not a DSE listing, or a lookup that
   * merely failed, silently became the most expensive query in the codebase,
   * and the route that had always answered in milliseconds timed out at sixty
   * seconds. Resolving the venue from data already in memory costs nothing and
   * cannot turn a miss into a stampede.
   */
  const { ASSETS } = await import("./assets");
  const us = ASSETS.find(
    (a) => a.symbol.toUpperCase() === sym || a.ticker.toUpperCase() === sym);

  if (us) {
    /*
     * Bounded independently of what the caller asked for. Round history is
     * read from the chain one call at a time, so `days` is a request, not an
     * instruction — a partner asking for five years must not be able to spend
     * a minute of compute to be told so.
     */
    const { getMarkets } = await import("./markets");
    const markets = await getMarkets({ depth: Math.min(120, days) }).catch(() => []);
    const m = markets.find((x) => x.symbol === us.symbol);
    if (!m) return null;
    return {
      symbol: m.symbol, venue: "US", currency: "USD",
      candles: (m.history ?? []) as Candle[],
      source: "chainlink", cachedAt: null,
    };
  }

  const { dseSecurity } = await import("./dseSecurities");
  const sec = await dseSecurity(sym).catch(() => null);
  if (!sec) return null;
  return dseSeries(sec.symbol, days, opts.sync !== false);
}

async function dseSeries(symbol: string, days: number, sync: boolean): Promise<PriceHistory> {
  const { dseHistory } = await import("./dse");
  let candles = await dseHistory(symbol, days).catch(() => []) as Candle[];
  let cachedAt: string | null = null;
  let source = "dse";

  if (dbConfigured) {
    try {
      await migrate();
      const sql = db();
      if (candles.length > 1) {
        await sql`
          insert into capx.price_history_cache (symbol, candles, fetched_at)
          values (${symbol}, ${sql.json(JSON.parse(JSON.stringify(candles)))}, now())
          on conflict (symbol) do update set candles = excluded.candles, fetched_at = now()`;
      } else {
        const [row] = await sql<{ candles: Candle[]; fetched_at: string }[]>`
          select candles, fetched_at from capx.price_history_cache where symbol = ${symbol}`;
        if (row) { candles = row.candles; cachedAt = new Date(row.fetched_at).toISOString(); }

        const { syncOraclePoints, oracleHistory } = await import("./oracleHistory");
        if (sync) await syncOraclePoints(12).catch(() => null);
        const ours = await oracleHistory(symbol).catch(() => []);
        const lastT = candles.length ? candles[candles.length - 1].t : 0;
        const newer = ours.filter((p) => p.t > lastT + 3600);
        if (newer.length) {
          candles = [...candles, ...newer];
          source = candles.length === newer.length ? "oracle" : "saved+oracle";
        } else if (row) {
          source = "saved";
        }
      }
    } catch { /* no fallback is no worse than none */ }
  }

  return { symbol, venue: "DSE", currency: "TZS", candles, source, cachedAt };
}
