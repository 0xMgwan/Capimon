import { NextResponse } from "next/server";
import { dseMarket } from "@/lib/dseTrading";
import { dseQuote, currentPrice } from "@/lib/dse";

export const dynamic = "force-dynamic";

/**
 * One DSE security's market, as a customer sees it.
 *
 * Both prices are reported: the oracle's, which is what a trade actually
 * settles at, and DSE's latest print, which is where that figure came from.
 * Showing only one would hide the gap between them on a day the publisher has
 * not caught up yet, and that gap is the thing worth seeing.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const [market, dse] = await Promise.all([
    dseMarket(symbol),
    dseQuote(symbol.toUpperCase()).catch(() => null),
  ]);
  if (!market) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });

  return NextResponse.json(
    {
      ok: true,
      market,
      dse: dse && {
        price: currentPrice(dse), live: dse.live,
        close: dse.close, change: dse.change, changePct: dse.changePct,
        tradeDate: dse.tradeDate, high: dse.high, low: dse.low, volume: dse.volume,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
