import { NextResponse } from "next/server";
import { dseBoard, dseLastTradeDate, quoteAgeDays } from "@/lib/dse";

export const dynamic = "force-dynamic";

/**
 * The DSE board for the ticker.
 *
 * Every quote carries the session it came from, and the response says how old
 * the newest one is. DSE prints once a day and does not print at weekends, so
 * a price with no date attached would look live on a Sunday afternoon when it
 * is two days old.
 */
export async function GET() {
  try {
    const [quotes, lastTradeDate] = await Promise.all([
      dseBoard(),
      dseLastTradeDate().catch(() => null),
    ]);

    const freshest = quotes.reduce<number>((n, q) => Math.min(n, quoteAgeDays(q)), Infinity);

    return NextResponse.json(
      {
        ok: true,
        lastTradeDate,
        ageDays: Number.isFinite(freshest) ? freshest : null,
        quotes: quotes.map((q) => ({
          symbol: q.symbol, name: q.name, close: q.close,
          change: q.change, changePct: q.changePct,
          volume: q.volume, tradeDate: q.tradeDate,
        })),
      },
      { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=600" } },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "DSE unavailable", quotes: [] },
      { status: 502 },
    );
  }
}
