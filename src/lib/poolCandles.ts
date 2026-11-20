import "server-only";

/**
 * What actually traded, as opposed to what the oracle marked.
 *
 * CAPX's US charts have always been a line of Chainlink rounds — one price
 * per print, no open, high, low or close, because a feed does not have
 * those. It is the honest shape for an oracle and the wrong shape for a
 * chart: a customer looking at NVDA wants to see what the market did, and an
 * oracle only tells them what it was worth at the moments it bothered to
 * speak.
 *
 * The trades are public. Every B20 equity has Aerodrome and Uniswap pools on
 * Base, and those swaps are already indexed with open/high/low/close and
 * volume. So the candles come from there.
 *
 * ## Two series, and they are not interchangeable
 *
 * The pool is where the price was made; the oracle is what CAPX prices
 * against. `executeBuy` refuses any route more than 15% from the oracle mark,
 * so on a volatile day a customer can see a wick the fill will never reach —
 * ANTc traded between $82.88 and $95.04 on its second day while the feed
 * stayed inside $83.20 and $89.24.
 *
 * That is not a reason to hide the trades. It is a reason to label which
 * series is which, which every caller here is made to do: `source` comes back
 * with the candles and says "market" or "oracle", and nothing in this file
 * ever silently substitutes one for the other.
 *
 * ## Why this is allowed to fail
 *
 * The index is a third party with no contract to us. Every function here
 * returns null rather than throwing, and the caller falls back to the oracle
 * line it drew before — a chart one grade coarser is a much smaller problem
 * than a chart that is not there.
 */

const API = "https://api.geckoterminal.com/api/v2/networks/base";
const TIMEOUT_MS = 6_000;

export type OHLC = { t: number; o: number; h: number; l: number; c: number; v: number };

/** Buckets a chart range actually wants, mapped to what the index serves. */
export const BUCKETS = {
  "5m": { path: "minute", aggregate: 5, seconds: 300 },
  "15m": { path: "minute", aggregate: 15, seconds: 900 },
  "1h": { path: "hour", aggregate: 1, seconds: 3_600 },
  "4h": { path: "hour", aggregate: 4, seconds: 14_400 },
  "1d": { path: "day", aggregate: 1, seconds: 86_400 },
} as const;

export type Bucket = keyof typeof BUCKETS;

/**
 * Picks the bucket that renders a range as a readable number of candles.
 *
 * Two or three hundred bars, which is where a candle is still wide enough to
 * read on a phone and dense enough to have a shape. A day of daily candles is
 * one bar; five years of five-minute candles is half a million and a timeout.
 */
export function bucketFor(days: number): Bucket {
  if (days <= 1) return "5m";    // 288
  if (days <= 3) return "15m";   // 288
  if (days <= 14) return "1h";   // 336
  if (days <= 60) return "4h";   // 360
  return "1d";
}

/**
 * How many bars that range needs, rather than a fixed number.
 *
 * Asking for a fixed count silently shortened every range: a week of
 * quarter-hour candles is 672 bars, so a limit of 150 drew a day and a half
 * and labelled it a week. The span is the thing the caller asked for, so it
 * is the span that decides the count.
 */
export function barsFor(days: number, bucket: Bucket): number {
  return Math.min(1000, Math.max(2, Math.ceil((days * 86_400) / BUCKETS[bucket].seconds)));
}

/**
 * An optional key, because the free tier is tight.
 *
 * Measured rather than assumed: a handful of requests in a few seconds
 * returns 429, and the same request a moment later returns seven hundred
 * rows. Thirteen securities on a cold cache is two calls each, which is
 * already close to the edge, so a deployment that cares can set a key and a
 * deployment that does not still works — slower, and falling back to the
 * oracle line more often.
 */
const API_KEY = (process.env.GECKOTERMINAL_API_KEY ?? "").trim();

async function get<T>(url: string): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: {
        accept: "application/json",
        "user-agent": "capx",
        ...(API_KEY ? { "x-cg-pro-api-key": API_KEY } : {}),
      },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Which pool is the real one, cached for a long time.
 *
 * A token has many pools and most are dust — ANTc has twenty, of which one
 * holds 1.17M dollars and does 13M a day, and the next does a hundred
 * thousand. Charting a dust pool draws a price nobody traded at. The answer
 * changes about as often as a new pool becomes dominant, which is to say
 * rarely, so it is held for an hour.
 */
const POOL_TTL_MS = 3_600_000;
const poolCache = new Map<string, { at: number; pool: string | null }>();

export async function topPoolFor(token: string): Promise<string | null> {
  const key = token.toLowerCase();
  const hit = poolCache.get(key);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.pool;

  type Resp = { data?: { attributes?: { address?: string; reserve_in_usd?: string;
                                        volume_usd?: { h24?: string } } }[] };
  const d = await get<Resp>(`${API}/tokens/${token}/pools?page=1`);
  const pools = d?.data ?? [];

  /*
   * Ranked by 24h volume rather than liquidity. A deep pool nobody trades
   * produces a flat line with gaps; the chart wants wherever price discovery
   * is actually happening.
   */
  let best: string | null = null;
  let bestVol = -1;
  for (const p of pools) {
    const a = p.attributes ?? {};
    const vol = Number(a.volume_usd?.h24 ?? 0);
    if (a.address && vol > bestVol) { bestVol = vol; best = a.address; }
  }

  poolCache.set(key, { at: Date.now(), pool: best });
  return best;
}

/*
 * Candles themselves, cached for less than the bucket they describe.
 *
 * The newest candle is still forming, so there is no point holding it past
 * the point where it would have changed; and every reader of the same market
 * page in that window should cost one request rather than one each. Thirty
 * seconds is under the shortest bucket and keeps a busy market responsive.
 */
const CANDLE_TTL_MS = 30_000;
/** After a failure, retry soon rather than serving nothing for a full TTL. */
const RETRY_AFTER_MS = 10_000;
/** How long a last-good series stays worth drawing while the index is down. */
const STALE_OK_MS = 1_800_000;

type Entry = {
  at: number;
  data: OHLC[] | null;
  /** The last series that actually came back, kept past its own freshness. */
  good?: { at: number; data: OHLC[] };
};
const candleCache = new Map<string, Entry>();

export async function poolCandles(
  token: string, bucket: Bucket, limit = 300,
): Promise<OHLC[] | null> {
  const key = `${token.toLowerCase()}:${bucket}:${limit}`;
  const now = Date.now();
  const hit = candleCache.get(key);
  if (hit && now - hit.at < (hit.data ? CANDLE_TTL_MS : RETRY_AFTER_MS)) return hit.data;

  /*
   * A rate limit must not blank a chart that was fine a moment ago.
   *
   * The free tier returns 429 readily — a few requests in a few seconds is
   * enough — and the obvious handling, cache the null and move on, means one
   * throttled request takes candles away from every reader for the next
   * window. So a failure falls back to the last series that did arrive, for
   * as long as it is still worth drawing, and retries sooner than a success
   * would.
   */
  const stale = (): OHLC[] | null => {
    const g = hit?.good;
    if (g && now - g.at < STALE_OK_MS) {
      candleCache.set(key, { at: now, data: g.data, good: g });
      return g.data;
    }
    candleCache.set(key, { at: now, data: null, good: hit?.good });
    return null;
  };

  const pool = await topPoolFor(token);
  if (!pool) return stale();

  const b = BUCKETS[bucket];
  type Resp = { data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } } };
  const d = await get<Resp>(
    `${API}/pools/${pool}/ohlcv/${b.path}?aggregate=${b.aggregate}&limit=${Math.min(1000, limit)}`);

  const rows = d?.data?.attributes?.ohlcv_list;
  if (!rows?.length) return stale();

  /* The index returns newest first; a chart reads left to right. */
  const out: OHLC[] = rows
    .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    .filter((k) => k.t > 0 && k.o > 0 && k.h > 0 && k.l > 0 && k.c > 0)
    .sort((a, z) => a.t - z.t);

  if (!out.length) return stale();
  candleCache.set(key, { at: now, data: out, good: { at: now, data: out } });
  return out;
}
