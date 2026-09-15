import "server-only";

/**
 * Prices from the Dar es Salaam Stock Exchange.
 *
 * DSE publishes several endpoints and they do not agree with each other. The
 * one called `live/market/prices` is the one to avoid: for most securities
 * neither its `price` nor its `price + change` equals the day's actual close —
 * checked against the exchange's own history, it matched for CRDB and failed
 * for DCB, NMB, TTP, TCCL, TCC, TPCC and SWIS. Reading it as a live price
 * would have put a number into the oracle that the exchange never printed.
 *
 * So everything here comes from the per-security history endpoint, which
 * returns a dated row per trading day with open, high, low and close. That row
 * is the exchange's own record, it carries the date it belongs to, and the date
 * is what lets a stale price be recognised as stale instead of being served as
 * today's.
 */

const BASE = "https://dse.co.tz";
/** DSE prints once a day; a quote is only as fresh as the last session. */
const TTL_MS = 10 * 60 * 1000;

export type DseQuote = {
  symbol: string;
  name: string;
  /** Closing price in whole shillings. DSE quotes integers. */
  close: number;
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
      quote = {
        symbol: key,
        name: last.fullName ?? key,
        close,
        open: Number(last.opening_price),
        high: Number(last.high),
        low: Number(last.low),
        prevClose: prev,
        change: prev === null ? 0 : close - prev,
        changePct: prev ? ((close - prev) / prev) * 100 : 0,
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

/** How old a quote is, in whole days. */
export function quoteAgeDays(q: DseQuote, now = Date.now()): number {
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
