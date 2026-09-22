import { NextResponse } from "next/server";
import { dseHistory } from "@/lib/dse";
import { dseSecurity } from "@/lib/dseSecurities";

export const dynamic = "force-dynamic";

/** A DSE security's closing prices, one point per session the exchange printed. */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sec = await dseSecurity(symbol);
  if (!sec) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
  const candles = await dseHistory(sec.symbol, 365);
  return NextResponse.json(
    { ok: true, candles },
    // A session's close does not change once printed, so this can be cached
    // for a good while; the window is short enough to pick up today's.
    { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
