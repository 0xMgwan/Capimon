import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/**
 * What one customer holds, priced on both boards.
 *
 * Shilling securities are valued from the oracle mark in shillings and US
 * equities from their own feed in dollars. Nothing is converted into a single
 * currency: a customer who bought CRDB in shillings never saw a dollar figure
 * and showing them one would be inventing a number they cannot act on.
 */
export const GET = partnerRoute("GET /v1/users/:ref/positions", {}, async ({ caller, req }) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const ref = decodeURIComponent(parts[parts.length - 2] ?? "");
  const customer = await partnerCustomer(caller.partner.id, ref);
  if (!customer) return sendFail(fail("unknown_customer", "No customer of yours matches that.", 404));

  const [{ balances }, { dseSecurities }, { readOraclePrice }, { getMarkets }] = await Promise.all([
    import("@/lib/ledger"), import("@/lib/dseSecurities"),
    import("@/lib/oracle"), import("@/lib/markets"),
  ]);

  const [held, dse, us] = await Promise.all([
    balances(customer.id).catch(() => []),
    dseSecurities().catch(() => []),
    getMarkets({ depth: 1 }).catch(() => []),
  ]);

  const dseSet = new Set(dse.map((d) => d.symbol.toUpperCase()));
  const positions = [];
  let cashTzs = 0, cashUsdc = 0;

  for (const b of held) {
    if (b.asset === "TZS") { cashTzs = b.amount; continue; }
    if (b.asset === "USDC") { cashUsdc = b.amount; continue; }
    if (!(b.amount > 0)) continue;

    if (dseSet.has(b.asset.toUpperCase())) {
      const price = await readOraclePrice(b.asset).then((q) => q?.price ?? 0).catch(() => 0);
      positions.push({ security: b.asset, venue: "DSE", currency: "TZS",
                       qty: b.amount, price, value: b.amount * price });
    } else {
      const m = us.find((x) => x.symbol === b.asset);
      positions.push({ security: b.asset, ticker: m?.ticker ?? null, venue: m?.exchange ?? "US",
                       currency: "USD", qty: b.amount, price: m?.price ?? 0,
                       value: b.amount * (m?.price ?? 0) });
    }
  }

  return send({ ok: true, user_id: customer.id,
    cash: { TZS: cashTzs, USDC: cashUsdc }, positions });
});
