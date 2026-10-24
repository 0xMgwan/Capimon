import { partnerRoute, send, sendFail, fail, partnerCustomer, partnerLimitRefusal } from "@/lib/partnerApi";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Buys and sells, on either board, for one of the partner's customers.
 *
 * Both venues go through the very same functions a CAPX customer's own order
 * goes through — placeSecurityOrder for Dar es Salaam, placeUsOrder for New
 * York. Every refusal they carry applies here unchanged: unverified accounts
 * cannot buy, a halted market is halted, inventory that is not held is not
 * sold, and solvency gates the whole thing. A partner cannot be given a path
 * that skips a check, because there is no second path to give them.
 *
 * `security` decides the venue. A DSE symbol prices in shillings and
 * `amount` is shillings; a US ticker prices in dollars and `amount` is
 * whichever currency `currency` names.
 */
export const POST = partnerRoute(
  "POST /v1/orders",
  { movesMoney: true, idempotent: true },
  async ({ caller, body }) => {
    const ref = String(body.user ?? body.user_id ?? body.reference ?? "").trim();
    const security = String(body.security ?? body.symbol ?? "").trim().toUpperCase();
    const side = body.side === "sell" ? "sell" : "buy";
    const amount = Number(body.amount);
    const currency = String(body.currency ?? "TZS").toUpperCase() === "USDC" ? "USDC" : "TZS";

    if (!ref) return sendFail(fail("user_required", "Name the customer with `user`."));
    if (!security) return sendFail(fail("security_required", "Name the security with `security`."));
    if (!Number.isFinite(amount) || amount <= 0) {
      return sendFail(fail("bad_amount", "`amount` must be a positive number."));
    }

    const customer = await partnerCustomer(caller.partner.id, ref);
    if (!customer) {
      return sendFail(fail("unknown_customer",
        "No customer of yours matches that id or reference.", 404));
    }

    /*
     * Credit anything of theirs that has become final since it arrived.
     *
     * A partner's natural sequence is deposit then buy, and between the two
     * sits the minute a Base block takes to be batched to Ethereum. Checking
     * here means that minute is spent on the partner's own round trip rather
     * than on waiting for a sweep, and a buy that would otherwise fail for
     * insufficient balance against money already sitting in the omnibus
     * simply works.
     */
    const { settleStablecoinDeposits } = await import("@/lib/stablecoinDeposits");
    await settleStablecoinDeposits(customer.id).catch(() => null);

    const { dseSecurities } = await import("@/lib/dseSecurities");
    const dse = await dseSecurities().catch(() => []);
    const isDse = dse.some((d) => d.symbol.toUpperCase() === security);

    /* The agreed ceilings, checked in shillings on the shilling board. */
    if (isDse || currency === "TZS") {
      const refusal = await partnerLimitRefusal(
        caller.partner.id, caller.partner.maxOrderTzs, caller.partner.maxDailyTzs,
        side === "buy" ? amount : 0,
      );
      if (refusal) return sendFail(refusal);
    }

    const result = isDse
      ? await (await import("@/lib/dseOrders")).placeSecurityOrder(customer,
          { security, side, amount })
      : await (await import("@/lib/usOrders")).placeUsOrder(customer,
          { symbol: security, side, amount, currency });

    if (!result.ok) {
      const { status, ok, ...rest } = result as { status?: number; ok: false } & Record<string, unknown>;
      void ok;
      return send({ ok: false, ...rest }, status ?? 400);
    }

    const { emit } = await import("@/lib/partners");
    void emit(caller.partner.id, "order.settled", {
      order_id: result.orderId, user_id: customer.id, reference: ref,
      security, side, qty: result.qty, price: result.price,
    }).catch(() => {});

    return send({ ok: true, order: {
      id: result.orderId, user_id: customer.id, reference: ref,
      security, side, qty: result.qty, price: result.price,
      amount: "tzs" in result ? result.tzs : result.usdc,
      currency: isDse ? "TZS" : currency,
      /* The DSE path quotes its fee; the US path takes it inside the swap and
         reports it on the order row instead. */
      fee: "fee" in result ? result.fee : null,
      status: "settled",
    } }, 201);
  },
);

/** The partner's own order history, newest first. */
export const GET = partnerRoute("GET /v1/orders", {}, async ({ caller, req }) => {
  await migrate();
  const u = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit") ?? 50)));
  const rows = await db()<{ id: string; side: string; symbol: string; qty: string | null;
                            price: string | null; status: string; created_at: string;
                            partner_ref: string | null; user_id: string;
                            usdc_amount: string | null; fee_usdc: string | null }[]>`
    select o.id::text, o.side, o.symbol, o.qty::text, o.price::text, o.status, o.created_at,
           u.partner_ref, u.id::text as user_id, o.usdc_amount::text, o.fee_usdc::text
      from capx.orders o join capx.users u on u.id = o.user_id
     where u.partner_id = ${caller.partner.id}::uuid
     order by o.created_at desc limit ${limit}`;
  return send({ ok: true, orders: rows.map((r) => ({
    id: r.id, user_id: r.user_id, reference: r.partner_ref,
    security: r.symbol, side: r.side, qty: Number(r.qty ?? 0),
    price: Number(r.price ?? 0), status: r.status, created_at: r.created_at,
  })) });
});
