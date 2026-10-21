import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/**
 * Turns one customer's dollars into shillings.
 *
 * The Dar es Salaam board prices and settles in shillings and reads a shilling
 * balance, so a customer holding only USDC cannot buy CRDB until this has run.
 * US equities need no conversion at all — they trade in dollars and a USDC
 * balance buys them directly.
 *
 * One direction. There is no shillings-to-dollars endpoint, because that
 * conversion happens inside a US buy at the moment it is needed, and offering
 * it on its own would make CAPX a currency desk.
 */
export const POST = partnerRoute(
  "POST /v1/convert",
  { movesMoney: true, idempotent: true },
  async ({ caller, body }) => {
    const ref = String(body.user ?? body.user_id ?? body.reference ?? "").trim();
    if (!ref) return sendFail(fail("user_required", "Name the customer with `user`."));

    const customer = await partnerCustomer(caller.partner.id, ref);
    if (!customer) {
      return sendFail(fail("unknown_customer", "No customer of yours matches that.", 404));
    }

    const { convertUsdcToTzs } = await import("@/lib/convert");
    const result = await convertUsdcToTzs(customer.id, {
      amountUsdc: Number(body.amount_usdc ?? body.amount),
      all: body.all === true,
    });

    if (!result.ok) {
      const { status, ok, ...rest } = result;
      void ok;
      return send({ ok: false, ...rest }, status);
    }
    return send({ ok: true, user_id: customer.id, reference: ref,
      converted: { usdc: result.usdc, tzs: result.tzs } });
  },
);
