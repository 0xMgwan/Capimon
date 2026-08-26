import "server-only";

/**
 * Routing runs through the KyberSwap aggregator on Base.
 *
 * Reading a single venue is not enough: B20 equity liquidity actually sits on
 * Aerodrome concentrated-liquidity pools, while some assets also have Uniswap
 * v3 and v4 pools — several of them dust-thin and mispriced. Aggregating is the
 * only way to see the price a user can really get, and it keeps working as
 * liquidity moves between venues.
 */

const BASE_URL = "https://aggregator-api.kyberswap.com/base/api/v1";
const CLIENT_ID = "capx";
const TIMEOUT_MS = 12_000;

export type RouteLeg = { exchange: string; swapAmount: string; pool: string };

export type RouteSummary = {
  tokenIn: string;
  amountIn: string;
  amountInUsd: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasUsd: string;
  route: RouteLeg[][];
};

export type Route = {
  routerAddress: `0x${string}`;
  routeSummary: RouteSummary;
  /** Distinct venue names across every hop, for display. */
  venues: string[];
};

/** Fee parameters the router applies inside the swap, when one is configured. */
export type RouteFee = {
  feeAmount: number;
  chargeFeeBy: "currency_in" | "currency_out";
  isInBps: true;
  feeReceiver: `0x${string}`;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: ctl.signal,
      headers: { "x-client-id": CLIENT_ID, ...(init?.body ? { "content-type": "application/json" } : {}) },
    });
    const j = await r.json();
    if (j.code !== undefined && j.code !== 0 && !j.data) {
      throw new Error(j.message || `aggregator error ${j.code}`);
    }
    if (!j.data) throw new Error(j.message || "no route");
    return j.data as T;
  } finally {
    clearTimeout(t);
  }
}

export async function getRoute(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountInRaw: bigint,
  fee?: RouteFee | null,
): Promise<Route | null> {
  const params = new URLSearchParams({
    tokenIn, tokenOut, amountIn: amountInRaw.toString(),
  });
  if (fee) {
    params.set("feeAmount", String(fee.feeAmount));
    params.set("chargeFeeBy", fee.chargeFeeBy);
    params.set("isInBps", "true");
    params.set("feeReceiver", fee.feeReceiver);
  }
  const url = `${BASE_URL}/routes?${params}`;
  try {
    const data = await call<{ routerAddress: `0x${string}`; routeSummary: RouteSummary }>(url);
    if (!data.routeSummary) return null;
    const venues = [
      ...new Set(data.routeSummary.route.flat().map((h) => h.exchange)),
    ];
    return { ...data, venues };
  } catch (e) {
    // "route not found" is a normal answer for an asset with no minted supply.
    if (e instanceof Error && /route not found|no route/i.test(e.message)) return null;
    throw e;
  }
}

/** Turns an accepted route into calldata the user's own wallet signs. */
export async function buildRoute(route: Route, sender: `0x${string}`, slippageBps: number) {
  return call<{
    routerAddress: `0x${string}`;
    data: `0x${string}`;
    amountIn: string;
    amountOut: string;
    gas: string;
    transactionValue: string;
  }>(`${BASE_URL}/route/build`, {
    method: "POST",
    body: JSON.stringify({
      routerAddress: route.routerAddress,
      routeSummary: route.routeSummary,
      sender,
      recipient: sender,
      slippageTolerance: slippageBps,
      source: CLIENT_ID,
    }),
  });
}

/** Aerodrome's internal ids are not presentable; map the common ones. */
export function venueLabel(id: string) {
  const map: Record<string, string> = {
    "aerodrome-cl-3": "Aerodrome CL",
    "aerodrome-cl": "Aerodrome CL",
    aerodrome: "Aerodrome",
    "uniswap-v3": "Uniswap v3",
    "uniswap-v4": "Uniswap v4",
    uniswapv3: "Uniswap v3",
    "pancake-v3": "PancakeSwap v3",
  };
  return map[id] ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
