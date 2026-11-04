import { partnerRoute, send, sendFail, fail } from "@/lib/partnerApi";
import { quoteOrderFor } from "@/lib/placeOrder";

export const dynamic = "force-dynamic";

/**
 * What an order would cost, for a confirm screen.
 *
 * Priced through the same functions that will run the trade, so a preview
 * cannot disagree with the fill. Showing a customer a fee computed from a
 * percentage written down somewhere else is how a confirm screen comes to
 * differ from a receipt, and the customer is the one who finds out.
 *
 * Indicative, and the response says so. Prices move between a quote and a
 * fill; a shilling order on the US board also converts at whatever rate the
 * swap reports at the moment it runs. Quote immediately before you confirm,
 * and treat the fill as the truth.
 */
export const GET = partnerRoute("GET /v1/quote", {}, async ({ req }) => {
  const u = new URL(req.url);
  const security = (u.searchParams.get("security") ?? u.searchParams.get("symbol") ?? "").trim();
  const side = u.searchParams.get("side") === "sell" ? "sell" : "buy";
  const amount = Number(u.searchParams.get("amount"));
  const currency = (u.searchParams.get("currency") ?? "TZS").toUpperCase() === "USDC"
    ? "USDC" as const : "TZS" as const;

  if (!security) {
    return sendFail(fail("security_required", "Name the security with `security`."));
  }

  const q = await quoteOrderFor({ security, side, amount, currency });
  if (!q.ok) {
    const { status, ok, ...rest } = q; void ok;
    return send({ ok: false, ...rest }, status);
  }

  return send({
    ok: true,
    quote: {
      security: q.security,
      venue: q.venue,
      side: q.side,
      price: q.price,
      qty: q.qty,
      /* On a buy: what leaves their balance. On a sell: what arrives. */
      amount: q.amount,
      currency: q.currency,
      fee: q.fee,
      fee_currency: q.feeCurrency,
      fee_bps: q.feeBps,
      fee_percent: q.feeBps / 100,
      net: q.net,
      indicative: true,
    },
    note: "Indicative. Quote immediately before confirming and treat the fill as the truth — "
        + "prices move, and a shilling order on the US board converts at the rate reported when "
        + "it runs.",
  });
});
