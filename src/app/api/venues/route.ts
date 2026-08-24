import { NextResponse } from "next/server";
import { parseUnits, formatUnits } from "viem";
import { ASSETS, USDC_BASE } from "@/lib/assets";
import { getMarkets } from "@/lib/markets";
import { getRoute, venueLabel } from "@/lib/aggregator";
import { bestPool } from "@/lib/aerodrome";

export const dynamic = "force-dynamic";

/** Reference size used to decide whether an asset is practically tradeable. */
const PROBE_USDC = 1_000;
const TTL_MS = 60_000;

type Venue = {
  symbol: string;
  tradeable: boolean;
  venues: string[];
  /** Round-trip cost against the oracle mark at the probe size, in percent. */
  spread: number | null;
};

let cache: { at: number; data: Venue[] } | null = null;
let inflight: Promise<void> | null = null;

async function probe(): Promise<Venue[]> {
  const markets = await getMarkets({ depth: 2 });
  const amountIn = parseUnits(String(PROBE_USDC), 6);

  return Promise.all(
    ASSETS.map(async (a) => {
      const m = markets.find((x) => x.symbol === a.symbol)!;
      try {
        const route = await getRoute(USDC_BASE, a.token, amountIn);
        if (route) {
          const out = Number(formatUnits(BigInt(route.routeSummary.amountOut), m.decimals));
          const oracleOut = m.price > 0 ? PROBE_USDC / m.price : 0;
          const spread = oracleOut > 0 ? ((out - oracleOut) / oracleOut) * 100 : null;
          return { symbol: a.symbol, tradeable: true, venues: route.venues.map(venueLabel), spread };
        }
      } catch {
        /* fall through */
      }
      // Aggregator unreachable or routeless — a deep Aerodrome pool still means
      // the asset is tradeable, so check before calling it mint-only.
      try {
        const pool = await bestPool(USDC_BASE, a.token);
        if (pool) return { symbol: a.symbol, tradeable: true, venues: ["Aerodrome CL"], spread: null };
      } catch {
        /* nothing routable */
      }
      return { symbol: a.symbol, tradeable: false, venues: [], spread: null };
    }),
  );
}

/**
 * Which assets can actually be bought today, and where. Probing thirteen routes
 * is too heavy for the market poll, so it gets its own longer-lived cache.
 */
export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      if (!inflight) {
        inflight = probe()
          .then((data) => { cache = { at: Date.now(), data }; })
          .finally(() => { inflight = null; });
      }
      if (!cache) await inflight;
    }
    return NextResponse.json(
      { ok: true, probeSize: PROBE_USDC, asOf: Math.floor(cache!.at / 1000), venues: cache!.data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "probe failed" }, { status: 502 });
  }
}
