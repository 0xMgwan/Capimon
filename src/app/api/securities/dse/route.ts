import { NextResponse } from "next/server";
import { dseSecurities } from "@/lib/dseSecurities";
import { dseQuote, currentPrice } from "@/lib/dse";
import { FEE_BPS, feeEnabled } from "@/lib/fees";
import { readOraclePrice } from "@/lib/oracle";

export const dynamic = "force-dynamic";

/**
 * Every tokenised DSE share customers can see, with today's price.
 *
 * Drafts are left out: a security CAPX has not taken live is not something a
 * customer should find in a list. Priced from DSE directly because this feeds
 * pickers and tickers; the oracle price a trade settles at is on the
 * per-security route.
 */
export async function GET() {
  const list = (await dseSecurities()).filter((s) => s.status !== "draft");
  /*
   * DSE first, our oracle when DSE is unreachable.
   *
   * The exchange's own server goes down from time to time, and this route used
   * to report every listing at 0 when it did — the hero ticket showed "—" and
   * "you receive 0" although trading carried on normally, because trades
   * settle at the oracle's price, not at DSE's page. The oracle holds the last
   * published mark, so that is what is shown, marked as not live.
   */
  const securities = await Promise.all(list.map(async (s) => {
    const q = await dseQuote(s.symbol).catch(() => null);
    const fallback = q ? null : await readOraclePrice(s.symbol).catch(() => null);
    return {
      symbol: s.symbol, name: s.name, logo: s.logo, status: s.status,
      price: q ? currentPrice(q) : fallback?.price ?? 0,
      changePct: q?.changePct ?? 0,
      tradeDate: q?.tradeDate ?? fallback?.updatedAt?.slice(0, 10) ?? null,
      source: q ? "dse" : fallback ? "oracle" : "none",
      // When the shown price was set: the exchange's session, or the oracle's
      // last publication when the exchange is unreachable.
      asOf: q ? null : fallback?.updatedAt ?? null,
      feeBps: feeEnabled ? FEE_BPS : 0,
    };
  }));
  return NextResponse.json({ ok: true, securities }, { headers: { "cache-control": "no-store" } });
}
