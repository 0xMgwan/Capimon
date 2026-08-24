import { NextResponse } from "next/server";
import { getMarkets } from "@/lib/markets";

export const revalidate = 0;
export const dynamic = "force-dynamic";

// Chainlink writes on deviation or heartbeat; a short server-side cache keeps
// every browser tab from fanning out its own multicall storm.
let cache: { at: number; data: Awaited<ReturnType<typeof getMarkets>> } | null = null;
let inflight: Promise<void> | null = null;
const TTL_MS = 6_000;

/** Stale-while-revalidate: one refresh in flight at a time, never a thundering herd. */
async function ensureFresh() {
  if (cache && Date.now() - cache.at < TTL_MS) return;
  if (!inflight) {
    inflight = getMarkets()
      .then((data) => { cache = { at: Date.now(), data }; })
      .finally(() => { inflight = null; });
  }
  if (!cache) await inflight;
}

export async function GET() {
  try {
    await ensureFresh();
    const markets = cache!.data;
    const tvl = markets.reduce((s, m) => s + m.tvl, 0);
    return NextResponse.json(
      {
        ok: true,
        asOf: Math.floor(Date.now() / 1000),
        chainId: 8453,
        totals: {
          tvl,
          assets: markets.length,
          listed: markets.filter((m) => m.supply > 0).length,
          lastUpdate: Math.max(...markets.map((m) => m.updatedAt)),
        },
        markets,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "upstream RPC error";
    if (cache) {
      return NextResponse.json({ ok: true, degraded: true, error: message, asOf: Math.floor(cache.at / 1000),
        chainId: 8453,
        totals: { tvl: cache.data.reduce((s, m) => s + m.tvl, 0), assets: cache.data.length,
          listed: cache.data.filter((m) => m.supply > 0).length,
          lastUpdate: Math.max(...cache.data.map((m) => m.updatedAt)) },
        markets: cache.data }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
