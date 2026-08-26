import { NextResponse } from "next/server";
import { parseUnits, isAddress } from "viem";
import { BY_SYMBOL, USDC_BASE } from "@/lib/assets";
import { getMarkets } from "@/lib/markets";
import { getRoute, buildRoute } from "@/lib/aggregator";
import { quote as aeroQuote, buildSwap as buildAeroSwap } from "@/lib/aerodrome";
import { feeParams } from "@/lib/fees";

export const dynamic = "force-dynamic";

const MAX_SLIPPAGE_BPS = 300;
/** Refuse to build a transaction the quote endpoint would have refused. */
const UNUSABLE_IMPACT = 15;

/**
 * Builds swap calldata for the user's wallet to sign. CAPIMON never holds keys
 * and never submits — the browser sends this to the connected wallet.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const asset = BY_SYMBOL[String(body.symbol ?? "").toLowerCase()];
    const side = body.side === "sell" ? "sell" : "buy";
    const amount = Number(body.amount);
    const sender = String(body.sender ?? "");
    const slippageBps = Math.min(MAX_SLIPPAGE_BPS, Math.max(10, Number(body.slippageBps) || 100));

    if (!asset) return NextResponse.json({ ok: false, error: "unknown asset" }, { status: 404 });
    if (!(amount > 0)) return NextResponse.json({ ok: false, error: "amount must be > 0" }, { status: 400 });
    if (!isAddress(sender)) return NextResponse.json({ ok: false, error: "bad sender" }, { status: 400 });

    const markets = await getMarkets({ depth: 2 });
    const market = markets.find((m) => m.symbol === asset.symbol)!;
    const inDecimals = side === "buy" ? 6 : market.decimals;
    const outDecimals = side === "buy" ? market.decimals : 6;

    const tokenIn = side === "buy" ? USDC_BASE : asset.token;
    const tokenOut = side === "buy" ? asset.token : USDC_BASE;
    const amountInRaw = parseUnits(amount.toString(), inDecimals);
    const oracleOut = side === "buy" ? amount / market.price : amount * market.price;

    let route: Awaited<ReturnType<typeof getRoute>> = null;
    try {
      route = await getRoute(tokenIn, tokenOut, amountInRaw, feeParams(side));
    } catch {
      /* fall through to the direct Aerodrome path */
    }

    if (!route) {
      // Same guard as the aggregated path: grade the direct fill before building.
      const direct = await aeroQuote(tokenIn, tokenOut, amountInRaw).catch(() => null);
      if (!direct) return NextResponse.json({ ok: false, error: "no route available" }, { status: 409 });

      const out = Number(direct.amountOut) / 10 ** outDecimals;
      const impact = oracleOut > 0 ? ((out - oracleOut) / oracleOut) * 100 : 0;
      if (Math.abs(impact) >= UNUSABLE_IMPACT) {
        return NextResponse.json(
          { ok: false, error: `route is ${impact.toFixed(1)}% from the oracle mark — refusing to build`, impact },
          { status: 409 },
        );
      }
      const minOut = (direct.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
      const built = buildAeroSwap({
        tokenIn, tokenOut, tickSpacing: direct.pool.tickSpacing,
        recipient: sender as `0x${string}`, amountIn: amountInRaw, amountOutMinimum: minOut,
      });
      return NextResponse.json({
        ok: true, source: "aerodrome", feeApplied: false, ...built,
        gas: direct.gasEstimate.toString(),
        amountOut: direct.amountOut.toString(),
        priceImpact: impact,
      }, { headers: { "cache-control": "no-store" } });
    }

    // Re-check against the mark: the route may have moved since the quote.
    const out = Number(BigInt(route.routeSummary.amountOut)) / 10 ** outDecimals;
    const impact = oracleOut > 0 ? ((out - oracleOut) / oracleOut) * 100 : 0;
    if (Math.abs(impact) >= UNUSABLE_IMPACT) {
      return NextResponse.json(
        { ok: false, error: `route is ${impact.toFixed(1)}% from the oracle mark — refusing to build`, impact },
        { status: 409 },
      );
    }

    const built = await buildRoute(route, sender as `0x${string}`, slippageBps);

    return NextResponse.json({
      ok: true,
      source: "aggregator",
      feeApplied: !!feeParams(side),
      to: built.routerAddress,
      data: built.data,
      value: built.transactionValue ?? "0",
      gas: built.gas,
      amountOut: built.amountOut,
      spender: built.routerAddress,
      priceImpact: impact,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "build failed" },
      { status: 502 },
    );
  }
}
