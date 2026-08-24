import { NextResponse } from "next/server";
import { parseUnits, formatUnits } from "viem";
import { BY_SYMBOL, USDC_BASE } from "@/lib/assets";
import { getMarkets } from "@/lib/markets";
import { getRoute, venueLabel } from "@/lib/aggregator";
import { quote as aeroQuote } from "@/lib/aerodrome";

export const dynamic = "force-dynamic";

/**
 * Grade every fill against the Chainlink mark. Aggregated routing normally
 * lands within a few basis points, but some B20 pools hold dust liquidity at a
 * stale price and will still quote an executable — and ruinous — fill.
 */
const ELEVATED_IMPACT = 1;  // %, warn
const SEVERE_IMPACT = 5;    // %, block behind an explicit acknowledgement
const UNUSABLE_IMPACT = 15; // %, refuse to route

function grade(impact: number) {
  const away = Math.abs(impact);
  if (away >= UNUSABLE_IMPACT) return { severity: "unusable" as const, safe: false, overridable: false };
  if (away >= SEVERE_IMPACT) return { severity: "severe" as const, safe: false, overridable: true };
  if (away >= ELEVATED_IMPACT) return { severity: "elevated" as const, safe: true, overridable: true };
  return { severity: "ok" as const, safe: true, overridable: true };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const asset = BY_SYMBOL[(u.searchParams.get("symbol") ?? "").toLowerCase()];
  const side = u.searchParams.get("side") === "sell" ? "sell" : "buy";
  const amount = Number(u.searchParams.get("amount") ?? "0");
  if (!asset) return NextResponse.json({ ok: false, error: "unknown asset" }, { status: 404 });
  if (!(amount > 0)) return NextResponse.json({ ok: false, error: "amount must be > 0" }, { status: 400 });

  try {
    const markets = await getMarkets({ depth: 2 });
    const market = markets.find((m) => m.symbol === asset.symbol)!;

    const tokenIn = side === "buy" ? USDC_BASE : asset.token;
    const tokenOut = side === "buy" ? asset.token : USDC_BASE;
    const inDecimals = side === "buy" ? 6 : market.decimals;
    const outDecimals = side === "buy" ? market.decimals : 6;
    const amountInRaw = parseUnits(amount.toString(), inDecimals);

    // What the oracle says the fill should be, before venue fees and slippage.
    const oracleOut = side === "buy" ? amount / market.price : amount * market.price;

    // Aggregated routing first; if it is unreachable, fall back to quoting the
    // deepest Aerodrome CL pool directly so the desk never goes dark.
    let route: Awaited<ReturnType<typeof getRoute>> = null;
    let degraded = false;
    try {
      route = await getRoute(tokenIn, tokenOut, amountInRaw);
    } catch {
      degraded = true;
    }

    if (!route) {
      const direct = await aeroQuote(tokenIn, tokenOut, amountInRaw).catch(() => null);
      if (direct) {
        const amountOut = Number(formatUnits(direct.amountOut, outDecimals));
        const impact = oracleOut > 0 ? ((amountOut - oracleOut) / oracleOut) * 100 : 0;
        const g = grade(impact);
        return NextResponse.json({
          ok: true, executable: true, source: "aerodrome", degraded: true,
          symbol: asset.symbol, side, amountIn: amount, amountOut, oracleOut,
          oraclePrice: market.price,
          executionPrice: side === "buy" ? amount / amountOut : amountOut / amount,
          priceImpact: impact, ...g,
          severity: g.severity, safe: g.safe, overridable: g.overridable,
          venues: ["Aerodrome CL"], hops: 1,
          tickSpacing: direct.pool.tickSpacing, pool: direct.pool.address,
          note: "Aggregated routing is unavailable — quoting the deepest Aerodrome pool directly. The fill may be slightly worse than a split route.",
        }, { headers: { "cache-control": "no-store" } });
      }
    }

    if (!route) {
      return NextResponse.json({
        ok: true, executable: false, reason: degraded ? "routing-unavailable" : "no-route",
        severity: "none", safe: false, overridable: false, degraded,
        symbol: asset.symbol, side, amountIn: amount, oracleOut, oraclePrice: market.price,
        supply: market.supply,
        note: degraded
          ? "Routing is temporarily unavailable and no direct Aerodrome pool could be quoted. The oracle mark above is still live."
          : market.supply > 0
          ? "No routable liquidity for this size right now across the venues we aggregate."
          : "No tokens have been minted on Base for this asset yet, so there is no secondary market to route through. Mint runs through the issuer under KYC.",
      }, { headers: { "cache-control": "no-store" } });
    }

    const amountOut = Number(formatUnits(BigInt(route.routeSummary.amountOut), outDecimals));
    const impact = oracleOut > 0 ? ((amountOut - oracleOut) / oracleOut) * 100 : 0;
    const { severity, safe, overridable } = grade(impact);

    return NextResponse.json({
      ok: true, executable: true, source: "aggregator", symbol: asset.symbol, side, amountIn: amount, amountOut, oracleOut,
      oraclePrice: market.price,
      executionPrice: side === "buy" ? amount / amountOut : amountOut / amount,
      priceImpact: impact, severity, safe, overridable,
      venues: route.venues.map(venueLabel),
      hops: route.routeSummary.route.length,
      amountInUsd: Number(route.routeSummary.amountInUsd),
      amountOutUsd: Number(route.routeSummary.amountOutUsd),
      gas: route.routeSummary.gas,
      gasUsd: Number(route.routeSummary.gasUsd),
      router: route.routerAddress,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "quote failed" },
      { status: 502 },
    );
  }
}
