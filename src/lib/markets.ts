import "server-only";
import { formatUnits } from "viem";
import { ASSETS, type AssetMeta } from "./assets";
import { aggregatorAbi, b20Abi } from "./abis";
import { publicClient } from "./chain";

export type Candle = { t: number; p: number; round: string };

export type Market = AssetMeta & {
  /** Issuer artwork, decoded from the B20 contractURI (ERC-7572). */
  logo: string | null;
  price: number;
  priceRaw: string;
  feedDecimals: number;
  updatedAt: number;
  roundId: string;
  /** Percent move over `changeWindowHours`, derived from Chainlink round history. */
  change: number;
  changeWindowHours: number;
  /** WAD multiplier encoding corporate actions. 1.0 means no adjustment applied yet. */
  multiplier: number;
  decimals: number;
  /** Circulating tokens, multiplier-adjusted (share-equivalent). */
  supply: number;
  rawSupply: number;
  tvl: number;
  history: Candle[];
  stale: boolean;
};

const PHASE_MASK = (1n << 64n) - 1n;

/** Walk back `count` Chainlink rounds inside the current phase via multicall. */
async function history(feed: `0x${string}`, latestRound: bigint, count: number): Promise<Candle[]> {
  const phase = latestRound >> 64n;
  const agg = latestRound & PHASE_MASK;
  const ids: bigint[] = [];
  for (let i = 0n; i < BigInt(count) && agg - i >= 1n; i++) ids.push((phase << 64n) | (agg - i));

  const res = await publicClient.multicall({
    contracts: ids.map((id) => ({ address: feed, abi: aggregatorAbi, functionName: "getRoundData", args: [id] } as const)),
    allowFailure: true,
  });

  const out: Candle[] = [];
  res.forEach((r, i) => {
    if (r.status !== "success") return;
    const [roundId, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
    if (answer <= 0n || updatedAt === 0n) return;
    out.push({ t: Number(updatedAt), p: Number(formatUnits(answer, 8)), round: roundId.toString() });
    void ids[i];
  });
  return out.sort((a, b) => a.t - b.t);
}

/**
 * contractURI is effectively static, so logos are fetched once and kept for the
 * life of the server process rather than on every market poll.
 */
const logoCache = new Map<string, string | null>();
let logosInflight: Promise<void> | null = null;

async function loadLogos() {
  if (logoCache.size >= ASSETS.length) return;
  if (!logosInflight) {
    logosInflight = publicClient
      .multicall({
        contracts: ASSETS.map((a) => ({ address: a.token, abi: b20Abi, functionName: "contractURI" } as const)),
        allowFailure: true,
      })
      .then((res) => {
        res.forEach((r, i) => {
          let image: string | null = null;
          if (r.status === "success") {
            try {
              const b64 = (r.result as string).split("base64,")[1];
              if (b64) image = JSON.parse(Buffer.from(b64, "base64").toString("utf8")).image ?? null;
            } catch {
              image = null;
            }
          }
          logoCache.set(ASSETS[i].symbol, image);
        });
      })
      .catch(() => {
        /* fall back to initials */
      })
      .finally(() => { logosInflight = null; });
  }
  await logosInflight;
}

const HISTORY_DEPTH = 120;
const HISTORY_TTL_MS = 90_000;

type HistEntry = { at: number; data: Candle[]; inflight?: Promise<Candle[]> };
const histCache = new Map<string, HistEntry>();

/**
 * Round history costs ~1.5k eth_calls per full refresh, so it gets its own cache
 * with a long TTL and stale-while-revalidate. Prices stay fast and fresh regardless.
 */
function cachedHistory(feed: `0x${string}`, latestRound: bigint, depth: number): Candle[] | Promise<Candle[]> {
  const key = `${feed}:${depth}`;
  const hit = histCache.get(key);
  const fresh = hit && Date.now() - hit.at < HISTORY_TTL_MS;

  if (!fresh && !hit?.inflight) {
    const p = history(feed, latestRound, depth)
      .then((d) => { histCache.set(key, { at: Date.now(), data: d }); return d; })
      .catch(() => {
        const e = histCache.get(key);
        if (e) e.inflight = undefined;
        return hit?.data ?? [];
      });
    histCache.set(key, { at: hit?.at ?? 0, data: hit?.data ?? [], inflight: p });
    if (!hit) return p; // nothing cached yet — this caller waits
  }
  return histCache.get(key)?.data ?? []; // serve cached, refresh in background
}

export async function getMarkets(opts: { depth?: number } = {}): Promise<Market[]> {
  const depth = opts.depth ?? HISTORY_DEPTH;

  const reads = await publicClient.multicall({
    contracts: ASSETS.flatMap((a) => [
      { address: a.feed, abi: aggregatorAbi, functionName: "latestRoundData" } as const,
      { address: a.feed, abi: aggregatorAbi, functionName: "decimals" } as const,
      { address: a.token, abi: b20Abi, functionName: "totalSupply" } as const,
      { address: a.token, abi: b20Abi, functionName: "decimals" } as const,
      { address: a.token, abi: b20Abi, functionName: "multiplier" } as const,
    ]),
    allowFailure: true,
  });

  const base = ASSETS.map((a, i) => {
    const s = i * 5;
    const rd = reads[s].status === "success"
      ? (reads[s].result as readonly [bigint, bigint, bigint, bigint, bigint])
      : ([0n, 0n, 0n, 0n, 0n] as const);
    const feedDecimals = reads[s + 1].status === "success" ? Number(reads[s + 1].result) : 8;
    const rawSupplyBig = reads[s + 2].status === "success" ? (reads[s + 2].result as bigint) : 0n;
    const decimals = reads[s + 3].status === "success" ? Number(reads[s + 3].result) : 8;
    const multBig = reads[s + 4].status === "success" ? (reads[s + 4].result as bigint) : 10n ** 18n;

    const price = Number(formatUnits(rd[1] < 0n ? 0n : rd[1], feedDecimals));
    const multiplier = Number(formatUnits(multBig, 18));
    const rawSupply = Number(formatUnits(rawSupplyBig, decimals));
    const supply = rawSupply * multiplier;

    return { meta: a, latestRound: rd[0], price, priceRaw: rd[1].toString(), feedDecimals,
      updatedAt: Number(rd[3]), decimals, multiplier, rawSupply, supply };
  });

  const [hist] = await Promise.all([
    Promise.all(base.map((b) => (b.latestRound > 0n ? cachedHistory(b.meta.feed, b.latestRound, depth) : []))),
    loadLogos(),
  ]);

  const now = Math.floor(Date.now() / 1000);

  return base.map((b, i) => {
    const h = hist[i];
    // Reference point for the headline move: the last print at least 24h old,
    // or the oldest print we have if the feed is younger than that.
    const cutoff = now - 86_400;
    const older = h.filter((c) => c.t <= cutoff);
    const ref = older.length ? older[older.length - 1] : h[0];
    const change = ref && ref.p > 0 && b.price > 0 ? ((b.price - ref.p) / ref.p) * 100 : 0;
    const windowHours = ref ? Math.max(1, Math.round((now - ref.t) / 3600)) : 0;

    return {
      ...b.meta,
      logo: logoCache.get(b.meta.symbol) ?? null,
      price: b.price,
      priceRaw: b.priceRaw,
      feedDecimals: b.feedDecimals,
      updatedAt: b.updatedAt,
      roundId: b.latestRound.toString(),
      change,
      changeWindowHours: Math.min(windowHours, 24),
      multiplier: b.multiplier,
      decimals: b.decimals,
      supply: b.supply,
      rawSupply: b.rawSupply,
      tvl: b.supply * b.price,
      history: h,
      // Feeds run 24/5 and freeze through corporate actions, so an overnight or
      // weekend gap is expected. Only flag a feed that has missed a full session.
      stale: b.updatedAt > 0 && now - b.updatedAt > 30 * 3600,
    };
  });
}
