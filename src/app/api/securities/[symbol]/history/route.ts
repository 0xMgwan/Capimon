import { NextResponse } from "next/server";
import { after } from "next/server";
import { priceHistory } from "@/lib/priceHistory";

export const dynamic = "force-dynamic";
// The background catch-up of oracle events runs after the response.
export const maxDuration = 60;

/**
 * A security's price series, on either board.
 *
 * The series itself, its fallbacks and the order they are tried live in
 * lib/priceHistory.ts, so the partner API serves the identical data rather
 * than a second implementation of it. What is left here is HTTP: read the
 * symbol, pick a cache header, keep the oracle current in the background.
 */
export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  /* The range decides the candle size, so it has to reach priceHistory —
     a day of daily bars is one bar. */
  const days = Number(new URL(req.url).searchParams.get("days") ?? 365);

  // Deferred, so a reader never waits for the catch-up — it only needs to be
  // complete before the next outage, not during this request.
  const result = await priceHistory(symbol, {
    sync: false, days: Number.isFinite(days) ? days : 365,
  });
  if (!result) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });

  after(async () => {
    const { syncOraclePoints } = await import("@/lib/oracleHistory");
    await syncOraclePoints(60).catch(() => null);
  });

  return NextResponse.json(
    { ok: true, candles: result.candles, cachedAt: result.cachedAt, source: result.source },
    /* A session's close does not change once printed, so a live DSE series
       keeps for a while. Live trades do change, so they do not. */
    { headers: { "cache-control": result.source === "dse"
        ? "public, max-age=300, stale-while-revalidate=3600"
        : result.source === "market"
        ? "public, max-age=15, stale-while-revalidate=60"
        : "public, max-age=30" } },
  );
}
