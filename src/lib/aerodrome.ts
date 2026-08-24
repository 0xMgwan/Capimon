import "server-only";
import { encodeFunctionData } from "viem";
import { AERO_CL_FACTORY, AERO_CL_QUOTER, AERO_CL_ROUTER, AERO_TICK_SPACINGS } from "./assets";
import { aeroFactoryAbi, aeroPoolAbi, aeroQuoterAbi, aeroRouterAbi } from "./abis";
import { publicClient } from "./chain";

/**
 * Direct Aerodrome Slipstream integration — the fallback for when the
 * aggregator is unreachable. Single-hop only: it quotes the deepest
 * <asset>/USDC pool rather than trying to reproduce multi-venue routing.
 */

export type AeroPool = { address: `0x${string}`; tickSpacing: number; fee: number; liquidity: bigint };

/** Deepest pool for the pair across every tick spacing Slipstream uses. */
export async function bestPool(tokenA: `0x${string}`, tokenB: `0x${string}`): Promise<AeroPool | null> {
  const found = await publicClient.multicall({
    contracts: AERO_TICK_SPACINGS.map((ts) => ({
      address: AERO_CL_FACTORY, abi: aeroFactoryAbi, functionName: "getPool", args: [tokenA, tokenB, ts],
    } as const)),
    allowFailure: true,
  });

  const live: { address: `0x${string}`; tickSpacing: number }[] = [];
  found.forEach((r, i) => {
    if (r.status !== "success") return;
    const address = r.result as `0x${string}`;
    if (address === "0x0000000000000000000000000000000000000000") return;
    live.push({ address, tickSpacing: AERO_TICK_SPACINGS[i] });
  });
  if (!live.length) return null;

  const state = await publicClient.multicall({
    contracts: live.flatMap((p) => [
      { address: p.address, abi: aeroPoolAbi, functionName: "liquidity" } as const,
      { address: p.address, abi: aeroPoolAbi, functionName: "fee" } as const,
    ]),
    allowFailure: true,
  });

  const pools: AeroPool[] = live.map((p, i) => ({
    ...p,
    liquidity: state[i * 2].status === "success" ? (state[i * 2].result as bigint) : 0n,
    fee: state[i * 2 + 1].status === "success" ? Number(state[i * 2 + 1].result) : 0,
  }));

  const best = pools.reduce((a, b) => (b.liquidity > a.liquidity ? b : a));
  return best.liquidity > 0n ? best : null;
}

/** Simulates the swap against the Slipstream quoter for a real fill. */
export async function quote(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
): Promise<{ amountOut: bigint; pool: AeroPool; gasEstimate: bigint } | null> {
  const pool = await bestPool(tokenIn, tokenOut);
  if (!pool) return null;

  const { result } = await publicClient.simulateContract({
    address: AERO_CL_QUOTER, abi: aeroQuoterAbi, functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, tickSpacing: pool.tickSpacing, sqrtPriceLimitX96: 0n }],
  });
  const [amountOut, , , gasEstimate] = result;
  return amountOut > 0n ? { amountOut, pool, gasEstimate } : null;
}

/** Calldata for the user's wallet to sign against the Slipstream router. */
export function buildSwap(params: {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  tickSpacing: number;
  recipient: `0x${string}`;
  amountIn: bigint;
  amountOutMinimum: bigint;
}) {
  return {
    to: AERO_CL_ROUTER,
    data: encodeFunctionData({
      abi: aeroRouterAbi,
      functionName: "exactInputSingle",
      args: [{
        ...params,
        // 20 minutes is long enough for a wallet confirmation, short enough
        // that a forgotten transaction cannot land at a stale price.
        deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
        sqrtPriceLimitX96: 0n,
      }],
    }),
    value: "0",
    spender: AERO_CL_ROUTER,
  };
}
