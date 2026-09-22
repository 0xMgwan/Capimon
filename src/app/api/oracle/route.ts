import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db, migrate, dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

/** How old a mark may be before settlement should refuse it (Rule 8). */
const MAX_AGE_MS = 60 * 60_000;

function authorised(req: Request) {
  if (!ADMIN_TOKEN) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Reference prices, public.
 *
 * Freshness is computed here rather than left to the reader: whether a mark may
 * price a trade is the same question everywhere, and duplicating the rule in
 * each caller is how two screens end up disagreeing about it.
 */
export async function GET() {
  if (!dbConfigured) return NextResponse.json({ ok: true, quotes: [] });
  try {
    await migrate();
    const rows = await db()<{ symbol: string; price_tzs: string; source: string; updated_at: string }[]>`
      select symbol, price_tzs::text, source, updated_at from capx.oracle_prices order by symbol`;
    const now = Date.now();
    return NextResponse.json({
      ok: true,
      maxAgeSeconds: MAX_AGE_MS / 1000,
      quotes: rows.map((r) => ({
        symbol: r.symbol,
        price: Number(r.price_tzs),
        source: r.source,
        updatedAt: r.updated_at,
        fresh: now - new Date(r.updated_at).getTime() <= MAX_AGE_MS,
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not read prices" },
      { status: 500 },
    );
  }
}

/** Records a mark. Whole shillings in; the source is required, not optional. */
export async function POST(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const priceTzs = Number(body.priceTzs);
    const source = String(body.source ?? "").trim();

    if (!symbol) return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
    if (!(priceTzs > 0)) return NextResponse.json({ ok: false, error: "price must be greater than zero" }, { status: 400 });
    // A mark without a source cannot be audited later, which defeats the point
    // of recording it at all.
    if (!source) return NextResponse.json({ ok: false, error: "source is required" }, { status: 400 });

    /*
     * On-chain first, database second.
     *
     * Settlement prices trades from the oracle contract, so a mark that only
     * reached this table was invisible to it: the desk listed the price as
     * live while every order was refused for having no price. The row is a
     * record of what was set, not the mark itself.
     */
    const { publishManualPrice } = await import("@/lib/oracle");
    const { txHash } = await publishManualPrice(symbol, priceTzs, source);

    await migrate();
    await db()`
      insert into capx.oracle_prices (symbol, price_tzs, source, updated_at)
      values (${symbol}, ${priceTzs}, ${source}, now())
      on conflict (symbol) do update
        set price_tzs = excluded.price_tzs, source = excluded.source, updated_at = now()`;

    return NextResponse.json({ ok: true, symbol, price: priceTzs, source, txHash });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not set the price" },
      { status: 500 },
    );
  }
}
