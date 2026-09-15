import "server-only";

/**
 * Prices from the Dar es Salaam Stock Exchange.
 *
 * Two endpoints, and which one is right depends on the time of day.
 *
 * The history endpoint returns a dated row per session with open, high, low and
 * close. That is the exchange's own record and it carries the date it belongs
 * to, which is what lets a stale price be recognised rather than served as
 * today's. It is authoritative, and it only appears after a session closes.
 *
 * `live/market/prices` carries the session in progress, in a shape that is easy
 * to misread: its `price` is the *previous* close and its `change` is today's
 * move so far, so the live price is the two added together. Reading `price`
 * alone gives yesterday's number, which is how this was first dismissed as
 * unreliable — tested before the market opened, when `change` still held the
 * previous completed session's move and the arithmetic was describing the wrong
 * day.
 *
 * Rather than guessing from the clock whether a session is running, the feed is
 * asked to prove it: the live entry is only trusted when its `price` equals the
 * last close the history endpoint published. When it does, the feed has rolled
 * forward and `change` belongs to today. When it does not, the session has not
 * opened yet and the published close stands. That test uses data already in
 * hand and does not care about trading hours, holidays or which timezone the
 * server thinks it is in.
 */

const BASE = "https://dse.co.tz";
/** DSE prints once a day; a quote is only as fresh as the last session. */
const TTL_MS = 10 * 60 * 1000;

export type DseQuote = {
  symbol: string;
  name: string;
  /** Closing price in whole shillings. DSE quotes integers. */
  close: number;
  /**
   * The price right now, when a session is running and the feed proves it.
   * Null once the market is closed, where `close` is the only real figure.
   */
  live: number | null;
  open: number;
  high: number;
  low: number;
  /** Previous session's close, when there is one. */
  prevClose: number | null;
  /** Absolute and percentage move against the previous close. */
  change: number;
  changePct: number;
  volume: number;
  /** The session this price belongs to, as an ISO date. */
  tradeDate: string;
  marketCap: number | null;
};

/** The figure to trade and display: live while a session runs, else the close. */
export function currentPrice(q: DseQuote): number {
  return q.live ?? q.close;
}

type Row = {
  trade_date: string; company: string; fullName: string;
  turnover: number; volume: number; high: number; low: number;
  opening_price: number; closing_price: number;
  shares_in_issue: number; market_cap: number;
};

async function dseFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
    // Next's fetch cache would serve a price from a previous session without
    // saying so. Freshness is handled here, where the trade date is visible.
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DSE ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

/** The listed equities. Only this endpoint enumerates them; its prices are not used. */
export async function dseUniverse(): Promise<string[]> {
  const d = await dseFetch<{ data: { company: string }[] }>("/api/get/live/market/prices");
  return (d.data ?? []).map((r) => r.company).filter(Boolean);
}

/** The session DSE last printed, as an ISO date. */
export async function dseLastTradeDate(): Promise<string | null> {
  const d = await dseFetch<{ success: boolean; data: string }>("/get/last/trade/date");
  return d.success ? d.data : null;
}

const cache = new Map<string, { at: number; quote: DseQuote | null }>();

type LiveRow = { company: string; price: number; change: number };
let liveCache: { at: number; rows: Map<string, LiveRow> } | null = null;

/**
 * The in-progress session, by symbol.
 *
 * Cached briefly rather than per security: one request covers the whole board,
 * and quoting twenty-six names should not mean twenty-six calls to the same
 * endpoint.
 */
async function liveBoard(): Promise<Map<string, LiveRow>> {
  if (liveCache && Date.now() - liveCache.at < 60_000) return liveCache.rows;
  try {
    const d = await dseFetch<{ data: LiveRow[] }>("/api/get/live/market/prices");
    const rows = new Map((d.data ?? []).map((r) => [r.company, r]));
    liveCache = { at: Date.now(), rows };
    return rows;
  } catch {
    // No live board means no live prices, not wrong ones.
    return new Map();
  }
}

/**
 * One security's most recent printed session.
 *
 * `days` is generous rather than 1 because a security that did not trade
 * yesterday still has a real last price, and asking for a single day would
 * return nothing and read as an outage.
 */
export async function dseQuote(symbol: string, opts: { force?: boolean } = {}): Promise<DseQuote | null> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (!opts.force && hit && Date.now() - hit.at < TTL_MS) return hit.quote;

  let quote: DseQuote | null = null;
  try {
    const d = await dseFetch<{ success: boolean; data: Row[] }>(
      `/api/get/market/prices/for/range/duration?security_code=${encodeURIComponent(key)}&days=30&class=EQUITY`,
    );
    const rows = (d.data ?? []).filter((r) => Number(r.closing_price) > 0);
    if (rows.length) {
      // The endpoint returns oldest first; the session we want is the last one.
      const last = rows[rows.length - 1];
      const prev = rows.length > 1 ? Number(rows[rows.length - 2].closing_price) : null;
      const close = Number(last.closing_price);

      /*
       * The live entry has to prove it belongs to a session after this close.
       * Its `price` is the previous close, so when that equals the close we
       * just read, the feed has rolled forward and its `change` is today's.
       */
      const liveRow = (await liveBoard()).get(key);
      const rolled = liveRow && Math.abs(Number(liveRow.price) - close) < 0.51;
      const live = rolled ? Number(liveRow.price) + Number(liveRow.change) : null;

      quote = {
        symbol: key,
        name: last.fullName ?? key,
        close,
        live: live !== null && live > 0 ? live : null,
        open: Number(last.opening_price),
        high: Number(last.high),
        low: Number(last.low),
        prevClose: prev,
        // Measured against whichever price is on screen: during a session the
        // move is today's, and after it the move is the one that closed.
        change: live !== null ? live - close : prev === null ? 0 : close - prev,
        changePct: live !== null
          ? (close ? ((live - close) / close) * 100 : 0)
          : prev ? ((close - prev) / prev) * 100 : 0,
        volume: Number(last.volume ?? 0),
        tradeDate: String(last.trade_date).slice(0, 10),
        marketCap: Number(last.market_cap) || null,
      };
    }
  } catch {
    // A quote that cannot be fetched is absent, not zero. Callers decide what
    // to do about a missing price; inventing one here would hide the outage.
    quote = null;
  }

  cache.set(key, { at: Date.now(), quote });
  return quote;
}

/**
 * The whole board, for the ticker.
 *
 * One request per security, which is why it is cached. Failures are dropped
 * rather than collapsing the board — a ticker missing one name is still useful,
 * a ticker that renders nothing is not.
 */
export async function dseBoard(): Promise<DseQuote[]> {
  let symbols: string[] = [];
  try {
    symbols = await dseUniverse();
  } catch {
    return [];
  }
  const quotes = await Promise.all(symbols.map((s) => dseQuote(s).catch(() => null)));
  return quotes.filter((q): q is DseQuote => q !== null)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * How old a quote is, in whole days.
 *
 * Zero while a session is running: the price is being made right now, even
 * though the dated row it is measured against belongs to the last close.
 */
export function quoteAgeDays(q: DseQuote, now = Date.now()): number {
  if (q.live !== null) return 0;
  const t = Date.parse(`${q.tradeDate}T00:00:00Z`);
  if (!Number.isFinite(t)) return Infinity;
  return Math.floor((now - t) / 86_400_000);
}

export type DseCandle = { t: number; p: number; round: string };

/**
 * A security's closing prices, as the chart wants them.
 *
 * One point per session, which is all DSE publishes — no interpolation between
 * days, because a line drawn through prices the exchange never printed is a
 * picture of nothing.
 */
export async function dseHistory(symbol: string, days = 180): Promise<DseCandle[]> {
  try {
    const d = await dseFetch<{ success: boolean; data: Row[] }>(
      `/api/get/market/prices/for/range/duration?security_code=${encodeURIComponent(symbol.toUpperCase())}&days=${days}&class=EQUITY`,
    );
    return (d.data ?? [])
      .filter((r) => Number(r.closing_price) > 0)
      .map((r) => ({
        t: Math.floor(Date.parse(`${String(r.trade_date).slice(0, 10)}T00:00:00Z`) / 1000),
        p: Number(r.closing_price),
        round: String(r.trade_date).slice(0, 10),
      }))
      .filter((c) => Number.isFinite(c.t))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}
