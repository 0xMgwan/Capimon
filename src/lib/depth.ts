import "server-only";
import { formatUnits, parseUnits } from "viem";
import { USDC_BASE } from "./assets";
import { getRoute } from "./aggregator";

/**
 * How much of a US equity somebody can actually buy right now.
 *
 * Three numbers get mistaken for this one, and all three mislead:
 *
 *   What CAPX holds. On this board CAPX holds no inventory to sell from — a
 *   buy routes to the market and acquires the shares as it settles — so the
 *   treasury's balance is backing for what customers already own and not a
 *   cap on what they may buy. Reported as "available", it said 0.009536 for
 *   a security anyone could buy a quarter of a million dollars of.
 *
 *   Onchain supply. Real, and somebody else's: 41,770 NVDAc exist, held by a
 *   lending market, some pools and a few thousand strangers, none of whom
 *   have offered to sell. A number you cannot transact against is not
 *   availability.
 *
 *   Pool liquidity. Closer, but it is the depth of one venue at one moment
 *   and the router uses several.
 *
 * The honest answer is the one the market gives when asked: quote a real
 * order and see what it costs. Availability is where that cost stops being
 * worth paying, so it is a function of a price you are willing to accept
 * rather than a quantity sitting anywhere.
 *
 * So this walks a ladder of real quotes and reports the largest that still
 * fills within `IMPACT_LIMIT_PCT` of the small-order price, in shares. The
 * ladder comes back too, because a partner sizing a bigger order deserves to
 * see the curve rather than one number off the end of it.
 */

/** Order sizes to quote, in dollars. Ascending, and the last is the ceiling. */
const RUNGS = [1_000, 10_000, 100_000, 250_000, 500_000] as const;

/**
 * Where "available" stops.
 *
 * Not the 15% at which a trade is refused outright — that is the line past
 * which a fill is evidence something is wrong, not a price anybody should be
 * offered. Two percent is the worst execution worth calling available.
 */
export const IMPACT_LIMIT_PCT = 2;

/** A quote that actually came back, at one size. */
export type Rung = { usd: number; shares: number; impactPct: number };

export type Depth = {
  /** The small-order price everything else is measured against. */
  referencePrice: number;
  ladder: Rung[];
  /** Largest ladder size filling within the limit. */
  maxOrderUsd: number;
  /** That size in shares — the figure to show as "available to buy". */
  availableShares: number;
  impactLimitPct: number;
  /** True when even the largest rung fills cheaply: the real depth is past it. */
  deeperThanProbed: boolean;
};

/**
 * Picks the answer out of whatever quotes came back.
 *
 * Pure, and separated from the fetching because this is the part with a
 * judgement in it. A rung that failed to quote is absent rather than zero —
 * the aggregator rate-limits, and treating a refused request as "no liquidity
 * at this size" would report a thin market every time we asked too fast.
 */
export function depthFrom(reference: number, ladder: Rung[]): Depth | null {
  if (!(reference > 0) || !ladder.length) return null;
  const sorted = [...ladder].sort((a, b) => a.usd - b.usd);

  /*
   * Walk up and stop at the first rung that costs too much. Deliberately not
   * "the largest rung under the limit": impact grows with size, and taking a
   * later cheap-looking quote past an expensive one would be reading noise in
   * a thin market as depth.
   */
  let best: Rung | null = null;
  for (const r of sorted) {
    if (r.impactPct > IMPACT_LIMIT_PCT) break;
    best = r;
  }
  if (!best) {
    /* Even the smallest probe costs more than the limit. Thin, not empty —
       the ladder still goes back so a caller can see what it would cost. */
    return { referencePrice: reference, ladder: sorted, maxOrderUsd: 0,
      availableShares: 0, impactLimitPct: IMPACT_LIMIT_PCT, deeperThanProbed: false };
  }

  return {
    referencePrice: reference,
    ladder: sorted,
    maxOrderUsd: best.usd,
    availableShares: best.shares,
    impactLimitPct: IMPACT_LIMIT_PCT,
    deeperThanProbed: best.usd === sorted[sorted.length - 1].usd
      && best.usd === RUNGS[RUNGS.length - 1],
  };
}

/* Quotes are a round trip each and the answer barely moves minute to minute,
   so one probe serves every reader for a while. */
const TTL_MS = 120_000;
const cache = new Map<string, { at: number; data: Depth | null }>();

export async function marketDepth(
  token: `0x${string}`, decimals: number, multiplier: number,
): Promise<Depth | null> {
  const key = token.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const quote = async (usd: number): Promise<Rung | null> => {
    try {
      const r = await getRoute(USDC_BASE, token, parseUnits(String(usd), 6));
      if (!r) return null;
      const raw = BigInt(r.routeSummary.amountOut);
      const shares = Number(formatUnits(raw, decimals)) * multiplier;
      return shares > 0 ? { usd, shares, impactPct: 0 } : null;
    } catch {
      return null;
    }
  };

  /* All at once: the ladder is independent, and five serial round trips would
     put a second and a half in front of anybody opening a market page. */
  const [ref, ...rest] = await Promise.all([quote(100), ...RUNGS.map(quote)]);
  if (!ref) {
    cache.set(key, { at: Date.now(), data: null });
    return null;
  }

  const referencePrice = ref.usd / ref.shares;
  const ladder = rest.filter((r): r is Rung => r !== null).map((r) => ({
    usd: r.usd,
    shares: r.shares,
    impactPct: Math.round(((r.usd / r.shares - referencePrice) / referencePrice) * 1e4) / 100,
  }));

  const data = depthFrom(referencePrice, ladder);
  cache.set(key, { at: Date.now(), data });
  return data;
}
