import { partnerRoute, send } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/**
 * Everything a partner's customer can buy, in one list.
 *
 * Both boards, with the currency each actually trades in: Dar es Salaam
 * securities in shillings, US equities in dollars. They are returned together
 * and labelled rather than split across two endpoints, because a partner
 * building a list screen wants one call and the difference that matters is a
 * field, not a URL.
 */
export const GET = partnerRoute("GET /v1/markets", {}, async () => {
  const [{ dseSecurities }, { getMarkets }, { readOraclePrice }] = await Promise.all([
    import("@/lib/dseSecurities"), import("@/lib/markets"), import("@/lib/oracle"),
  ]);

  const [dse, us] = await Promise.all([
    dseSecurities().catch(() => []),
    getMarkets({ depth: 1 }).catch(() => []),
  ]);

  const tz = await Promise.all(dse
    .filter((d) => d.status === "live")
    .map(async (d) => ({
      symbol: d.symbol,
      name: d.name,
      venue: "DSE",
      currency: "TZS" as const,
      price: await readOraclePrice(d.symbol).then((q) => q?.price ?? null).catch(() => null),
      logo: d.logo,
      tradable: true,
    })));

  return send({
    ok: true,
    markets: [
      ...tz,
      ...us.map((m) => ({
        symbol: m.symbol,
        ticker: m.ticker,
        name: m.name,
        venue: m.exchange,
        currency: "USD" as const,
        price: m.price,
        logo: m.logo,
        /* Supply is the honest tradability signal for a tokenised equity: a
           token nobody has minted cannot be routed to, whatever its feed says. */
        tradable: (m.supply ?? 0) > 0,
        onchain_supply: m.supply ?? 0,
      })),
    ],
  });
});
