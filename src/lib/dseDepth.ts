import "server-only";
import type { DseSession } from "./dse";

/**
 * How long it would take to sell a DSE position on the exchange.
 *
 * depth.ts answers this for the US board by asking the market: quote a real
 * order, see what it costs, and report the size where the cost stops being
 * worth paying. Nothing answered it for the Dar es Salaam board, and the
 * reason is that there is nobody to ask — a DSE share has no on-chain market,
 * no aggregator and no standing quote. The only evidence of what can be sold
 * is what has been sold, which the exchange publishes per session as volume.
 *
 * ## Why this is the figure that binds
 *
 * Every other number in the book is measured against a mark. Solvency is in
 * shares and cannot break on a price move; redemption asks what the marks
 * would cost in shillings; the facility asks who would front those shillings.
 * All three assume the mark is a price somebody would pay.
 *
 * That assumption is this file's subject. If CAPX's position in a security is
 * large against what the exchange trades in it, then the mark is not a price
 * the position can be sold at — it is the price of the last small trade — and
 * the figures built on it are describing a liquidation that cannot happen.
 * The provider facility does not fix that: a provider buys at the mark, so
 * they inherit exactly the same problem one seat along, and the shillings
 * they would need are the shillings this file says the exchange cannot
 * produce quickly.
 *
 * So the output is deliberately in sessions, not shillings. Days to cover is
 * the working capital question stated honestly: however the gap is financed,
 * this is how long the financing has to last.
 */

/**
 * The share of a session's volume one seller may assume is theirs.
 *
 * Not a hundred: a seller who is the entire day's volume is not participating
 * in a market, they are making the price, and the mark the position is valued
 * at is the first thing that would give way. A quarter is the conventional
 * ceiling in liquidity work and is generous for a frontier exchange, where a
 * quarter of a thin day is often one counterparty.
 *
 * It is a named export because every figure downstream is a function of it,
 * and a reader comparing two days-to-cover numbers is owed the assumption
 * rather than left to infer it.
 */
export const PARTICIPATION_PCT = 25;

/** Sessions of history to measure. A quarter: long enough to survive one
    quiet month, short enough that last year's liquidity is not evidence. */
export const WINDOW_DAYS = 90;

/**
 * How many sessions of liquidation the book is allowed to need.
 *
 * The cap this produces is the one control that acts on the depth rather than
 * reporting it. DSE settles T+3, so a position that clears in five sessions
 * is roughly eight days of funding between a customer asking for their money
 * and the shillings existing — long, and survivable. Past that the position
 * is only exitable by moving the price it is marked at, which makes the mark
 * fiction and every figure built on it fiction too.
 *
 * Five is also where `verdictFor` already stops saying "days", so the number
 * a desk reads and the number the gate enforces are the same number.
 */
export const MAX_COVER_SESSIONS = 5;

/** The largest client-held position the exchange can be asked to absorb. */
export const capFrom = (sellablePerSession: number) =>
  sellablePerSession * MAX_COVER_SESSIONS;

export type Verdict = "clear" | "days" | "weeks" | "illiquid";

/**
 * Where the bands fall, and why there.
 *
 * DSE settles T+3, so a position that clears inside one session is one whose
 * whole financing need is the settlement cycle — the thing a faster pledge
 * release would shrink. Past a week, the exchange is no longer the exit and
 * the position is being held because selling it would move it. Past a month
 * of sessions the mark is a quotation rather than a price.
 */
export function verdictFor(daysToCover: number): Verdict {
  if (!Number.isFinite(daysToCover)) return "illiquid";
  if (daysToCover <= 1) return "clear";
  if (daysToCover <= 5) return "days";
  if (daysToCover <= 20) return "weeks";
  return "illiquid";
}

export type Liquidity = {
  symbol: string;
  /** Sessions the exchange ran in the window. */
  sessions: number;
  /** Of those, the ones this security traded in at all. */
  tradedSessions: number;
  tradedPct: number;
  /** The typical session, in shares. Zero-filled, so a security that trades
      one day in five has a median of zero and that is the finding. */
  medianVolume: number;
  meanVolume: number;
  /**
   * mean ÷ median: how far the volume arrives in blocks rather than evenly.
   *
   * Null when the median is zero, because a ratio against nothing is not a
   * measure of lumpiness, it is a different finding entirely — already
   * reported by the median itself.
   */
  lumpiness: number | null;
  /** Shares one seller could expect to move in a session. */
  sellablePerSession: number;
  sellablePerSessionTzs: number;
  /**
   * The most clients may hold before new buys are refused.
   *
   * Zero where nothing trades, which closes the security to new money rather
   * than letting a position build in something that cannot be sold at all.
   */
  capShares: number;
  capTzs: number;
  /** Shares owed to customers. */
  clientHeld: number;
  markTzs: number;
  positionTzs: number;
  /**
   * Sessions to liquidate the position, and Infinity when nothing trades.
   *
   * JSON has no infinity, so it reaches a browser as null — which happens to
   * carry the right meaning, "this measurement cannot say", and is what the
   * panel reads. Said here because a reader of the type would otherwise
   * expect a number and a future serialiser could quietly turn it into one.
   */
  daysToCover: number;
  verdict: Verdict;
};

/** The middle of a list, averaging the pair when there is no middle. */
export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The arithmetic on its own, with nothing to fetch.
 *
 * Separated like depthFrom, and for the same reason: the judgement is here
 * and the fetching is not interesting to a test.
 *
 * `calendar` is every date the exchange ran a session, and a date in it this
 * security did not print counts as zero volume.
 *
 * It is a safety net rather than the main mechanism, which is worth being
 * straight about. The feed already returns a row per session with the volume
 * set to zero when nothing traded, so on today's data the zero-filling finds
 * nothing to fill. What the shared calendar buys is three things the feed
 * does not: a security whose history is shorter than the window — a new
 * listing, or one that stopped printing when it was suspended — is measured
 * over the exchange's sessions rather than its own, so five traded days out
 * of five does not read as a perfect record; every security is scored against
 * the same denominator, so two days-to-cover figures are comparable; and if
 * the feed ever does start omitting quiet sessions, the figures here do not
 * silently improve.
 *
 * It is the inverse convention to depth.ts, where a quote that failed is
 * absent rather than zero, because the two absences mean opposite things.
 * There, a missing quote is our own failure to ask, and calling it no
 * liquidity would report a thin market every time the aggregator rate-limited
 * us. Here, a session with no volume is the exchange saying nobody traded.
 */
export function liquidityFrom(args: {
  symbol: string;
  calendar: readonly string[];
  sessions: readonly DseSession[];
  clientHeld: number;
  markTzs: number;
}): Liquidity {
  const { symbol, calendar, sessions, clientHeld, markTzs } = args;

  const byDay = new Map(sessions.map((s) => [s.day, s]));
  /* Zero-filled against the calendar. A security's own rows cannot supply the
     calendar — it would only ever contain days it traded. */
  const volumes = calendar.map((d) => byDay.get(d)?.volume ?? 0);

  const sessionCount = volumes.length;
  const tradedSessions = volumes.filter((v) => v > 0).length;
  const medianVolume = median(volumes);
  const meanVolume = sessionCount ? volumes.reduce((a, b) => a + b, 0) / sessionCount : 0;

  const sellablePerSession = (medianVolume * PARTICIPATION_PCT) / 100;
  const positionTzs = clientHeld * markTzs;

  /*
   * Infinity rather than a large number when nothing trades.
   *
   * A median of zero does not mean the position takes a very long time to
   * sell, it means this measurement cannot say that it can be sold at all,
   * and a finite figure would invite somebody to plan against it.
   */
  const daysToCover = sellablePerSession > 0
    ? clientHeld / sellablePerSession
    : clientHeld > 0 ? Infinity : 0;

  return {
    symbol,
    sessions: sessionCount,
    tradedSessions,
    tradedPct: sessionCount ? (tradedSessions / sessionCount) * 100 : 0,
    medianVolume,
    meanVolume,
    lumpiness: medianVolume > 0 ? meanVolume / medianVolume : null,
    sellablePerSession,
    sellablePerSessionTzs: sellablePerSession * markTzs,
    capShares: capFrom(sellablePerSession),
    capTzs: capFrom(sellablePerSession) * markTzs,
    clientHeld,
    markTzs,
    positionTzs,
    daysToCover,
    verdict: verdictFor(daysToCover),
  };
}

/**
 * Securities asked for the trading calendar, over and above the measured ones.
 *
 * The calendar is the set of dates the feed returned a row for, and not the
 * dates on which something traded. The distinction is the difference between
 * two very different mistakes, and the exchange settles it: a row is returned
 * for every session in the window, carrying the previous close forward with
 * volume zero when nobody traded, and public holidays get no row at all —
 * checked on a ninety-day window where the feed returned 64 rows against 65
 * weekdays, the missing one being 14 October, Nyerere Day. So the feed is
 * already a session calendar and the exchange's own holidays come for free.
 *
 * Which rules out counting weekdays ourselves, and rules out taking only the
 * days a security traded: a liquid name that happens to be quiet on a real
 * session would delete that session from the denominator, which flatters
 * every security measured against it.
 *
 * What remains is that a security's own rows stop when it stops printing — a
 * suspension, a delisting, a listing younger than the window — and a book
 * measured over its own short history reports five traded days out of five as
 * a perfect record. These three are here to supply the full grid in that
 * case. The criterion is being certain to still be printing rather than being
 * liquid, and they are named rather than discovered because discovering them
 * means fetching the whole board to establish a calendar. When none can be
 * read the result says so instead of quietly falling back.
 */
const CALENDAR_BENCHMARKS = ["CRDB", "NMB", "TBL"] as const;

export type DseLiquidity = {
  windowDays: number;
  participationPct: number;
  /** Sessions found in the window. */
  sessions: number;
  /**
   * How the calendar was established. "self" means the benchmarks could not
   * be read and the measured securities supplied their own sessions. Usually
   * identical, since the feed returns the same grid for every security — but
   * a security that stopped printing would then be measured over the window
   * it still printed in, which flatters it. Reported rather than hidden.
   */
  calendarFrom: "benchmark" | "self";
  securities: Liquidity[];
  /** The slowest leg. A book liquidates no faster than its worst security. */
  worstDaysToCover: number;
  worst: string | null;
  /** Shillings the whole book could raise in one session at that participation. */
  perSessionTzs: number;
  /** Held positions with no readable mark, which nothing here can speak for. */
  unpriced: string[];
};

/* One request per security and the answer changes once a day. */
const TTL_MS = 15 * 60_000;
let cache: { at: number; data: DseLiquidity | null } | null = null;

/**
 * What customers hold in each DSE security, and how long selling it would take.
 *
 * Suspended securities are included deliberately. A security customers hold
 * and cannot currently trade is the exact case this figure exists for, and
 * filtering to live would drop it the moment it mattered most.
 */
export async function dseLiquidity(opts: { force?: boolean } = {}): Promise<DseLiquidity | null> {
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const { dbConfigured, db, migrate } = await import("./db");
  if (!dbConfigured) return null;

  const { dseSecurities } = await import("./dseSecurities");
  /* "external" is somebody else's token bought at another venue; the DSE
     publishes no volume for it and this measure does not apply. */
  const list = (await dseSecurities().catch(() => [])).filter((d) => d.kind === "dse");
  if (!list.length) {
    cache = { at: Date.now(), data: null };
    return null;
  }

  await migrate();
  const sql = db();
  const symbols = list.map((d) => d.symbol);

  const held = await sql<{ asset: string; qty: string }[]>`
    select asset, sum(amount)::text as qty
      from capx.ledger_entries
     where asset = any(${symbols})
     group by asset having sum(amount) > 0`.catch(() => []);
  const heldBy = new Map(held.map((r) => [r.asset, Number(r.qty)]));

  const { dseSessions } = await import("./dse");
  const { readOraclePrice } = await import("./oracle");

  /* The measured securities and the calendar benchmarks in one pass, so a
     benchmark that is also listed is fetched once. */
  const wanted = [...new Set([...symbols, ...CALENDAR_BENCHMARKS])];
  const fetched = await Promise.all(
    wanted.map(async (s) => [s, await dseSessions(s, WINDOW_DAYS).catch(() => [])] as const),
  );
  const sessionsBy = new Map(fetched);

  /* Every date the feed returned a row for is a session it ran. Volume is not
     consulted here on purpose: a quiet session is still a session. */
  const sessionDays = new Set<string>();
  for (const b of CALENDAR_BENCHMARKS) {
    for (const s of sessionsBy.get(b) ?? []) sessionDays.add(s.day);
  }

  const calendarFrom: "benchmark" | "self" = sessionDays.size > 0 ? "benchmark" : "self";
  if (calendarFrom === "self") {
    for (const s of symbols) {
      for (const row of sessionsBy.get(s) ?? []) sessionDays.add(row.day);
    }
  }
  const calendar = [...sessionDays].sort();

  const securities: Liquidity[] = [];
  const unpriced: string[] = [];

  for (const sec of list) {
    const clientHeld = heldBy.get(sec.symbol) ?? 0;
    /*
     * Securities nobody holds are measured too.
     *
     * They were skipped when this only reported, and that was wrong the
     * moment it also capped: a newly listed security has no position, so it
     * would have had no row, so it would have had no cap — leaving the one
     * case the cap exists for, a thin security taking its first money,
     * entirely ungated. The depth of a security has nothing to do with
     * whether we happen to hold it.
     */
    /* A mark we cannot read is zero, not a guess — the same rule redemption
       uses, and for the same reason: an invented price looks complete. */
    const markTzs = await readOraclePrice(sec.symbol)
      .then((p) => p?.price ?? 0).catch(() => 0);
    if (!(markTzs > 0)) unpriced.push(sec.symbol);
    securities.push(liquidityFrom({
      symbol: sec.symbol,
      calendar,
      sessions: sessionsBy.get(sec.symbol) ?? [],
      clientHeld,
      markTzs,
    }));
  }

  securities.sort((a, b) => {
    /* Slowest first, with Infinity ahead of everything. */
    if (a.daysToCover === b.daysToCover) return b.positionTzs - a.positionTzs;
    return b.daysToCover - a.daysToCover;
  });

  const worst = securities[0] ?? null;
  const data: DseLiquidity = {
    windowDays: WINDOW_DAYS,
    participationPct: PARTICIPATION_PCT,
    sessions: calendar.length,
    calendarFrom,
    securities,
    worstDaysToCover: worst?.daysToCover ?? 0,
    worst: worst && worst.daysToCover > 0 ? worst.symbol : null,
    perSessionTzs: securities.reduce((t, s) => t + s.sellablePerSessionTzs, 0),
    unpriced,
  };

  cache = { at: Date.now(), data };
  return data;
}

/**
 * The cap for one security, for the order path to enforce.
 *
 * Only the cap comes from here. The position it is compared against is read
 * live where the order is placed, because depth moves once a day and a book
 * moves with every trade — taking both from the same fifteen-minute cache
 * would let a burst of buys run straight through a limit that still looked
 * satisfied.
 *
 * Null when the depth cannot be established — the feed is down, the security
 * is not DSE-traded, nothing is published. A cap is a prudential limit and
 * not a safety interlock, so an unreadable measurement must not close the
 * market: it is the same judgement depth.ts makes about a quote that failed,
 * where treating our own inability to ask as evidence of a thin market would
 * halt trading every time an upstream blinked.
 */
export async function securityCap(symbol: string): Promise<number | null> {
  const liq = await dseLiquidity().catch(() => null);
  if (!liq) return null;
  const row = liq.securities.find((s) => s.symbol === symbol.toUpperCase());
  return row ? row.capShares : null;
}
