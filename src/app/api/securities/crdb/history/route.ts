import { NextResponse } from "next/server";
import { dseHistory } from "@/lib/dse";
import { CRDBT_SECURITY } from "@/lib/assets";

export const dynamic = "force-dynamic";

/** CRDB's closing prices, one point per session the exchange actually printed. */
export async function GET() {
  const candles = await dseHistory(CRDBT_SECURITY, 365);
  return NextResponse.json(
    { ok: true, candles },
    // A session's close does not change once printed, so this can be cached
    // for a good while; the window is short enough to pick up today's.
    { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
