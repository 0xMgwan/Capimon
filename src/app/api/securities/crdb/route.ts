import { NextResponse } from "next/server";
import { crdbMarket } from "@/lib/dseTrading";
import { dseQuote } from "@/lib/dse";
import { CRDBT_SECURITY } from "@/lib/assets";

export const dynamic = "force-dynamic";

/**
 * The CRDB market, as a customer sees it.
 *
 * Both prices are reported: the oracle's, which is what a trade actually
 * settles at, and DSE's latest print, which is where that figure came from.
 * Showing only one would hide the gap between them on a day the publisher has
 * not caught up yet, and that gap is the thing worth seeing.
 */
export async function GET() {
  const [market, dse] = await Promise.all([
    crdbMarket(),
    dseQuote(CRDBT_SECURITY).catch(() => null),
  ]);

  return NextResponse.json(
    {
      ok: true,
      market,
      dse: dse && {
        close: dse.close, change: dse.change, changePct: dse.changePct,
        tradeDate: dse.tradeDate, high: dse.high, low: dse.low, volume: dse.volume,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
