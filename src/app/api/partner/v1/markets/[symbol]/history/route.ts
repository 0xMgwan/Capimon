import { partnerRoute, send, sendFail, fail } from "@/lib/partnerApi";
import { priceHistory } from "@/lib/priceHistory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Price history for charting, on either board.
 *
 * The same series CAPX draws its own charts from, through the same function —
 * so a partner's chart and ours cannot disagree about what a security did.
 *
 * The two boards are not the same kind of data and the response says so
 * rather than flattening them. A Dar es Salaam series is in shillings, one
 * point per session the exchange printed. A US series is in dollars, built
 * from the Chainlink feed's own rounds, and is total-return: the published
 * price already carries the token's multiplier, so a split or a dividend
 * leaves no step in the line.
 *
 * `source` is worth reading rather than ignoring. "dse" is live from the
 * exchange; "saved" or "oracle" means the exchange could not be reached and
 * this is the last good series or the oracle's own record. Serving it is
 * better than a blank chart, but labelling it live would not be true.
 */
export const GET = partnerRoute(
  "GET /v1/markets/:symbol/history",
  {},
  async ({ req }) => {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const symbol = decodeURIComponent(parts[parts.length - 2] ?? "");
    const days = Number(new URL(req.url).searchParams.get("days") ?? 365);

    if (!symbol) return sendFail(fail("symbol_required", "Name the security in the path."));

    const result = await priceHistory(symbol, {
      days: Number.isFinite(days) ? days : 365,
    });
    if (!result) {
      return sendFail(fail("not_found",
        `No security called ${symbol}. Use the symbol from /v1/markets.`, 404));
    }

    return send({
      ok: true,
      symbol: result.symbol,
      venue: result.venue,
      currency: result.currency,
      source: result.source,
      cached_at: result.cachedAt,
      /*
       * Seconds, not milliseconds, and named rather than positional. A chart
       * library wants whatever it wants; an API that hands back bare tuples
       * makes every integrator guess which column is which.
       */
      candles: result.candles.map((c) => ({
        t: c.t,
        open: c.o ?? c.p ?? null,
        high: c.h ?? c.p ?? null,
        low: c.l ?? c.p ?? null,
        close: c.c ?? c.p ?? null,
      })),
    });
  },
);
