import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/**
 * Pays one of the partner's customers out to mobile money or a bank.
 *
 * Verified accounts only, and the same capacity rules as anywhere else: when
 * the float cannot cover it the payout is accepted and queued rather than
 * refused, and the response says so. A partner showing their customer
 * "withdrawal sent" when the body says `queued` would be misreporting it —
 * the field is there to be read.
 */
export const POST = partnerRoute(
  "POST /v1/withdrawals",
  { movesMoney: true, idempotent: true },
  async ({ caller, body }) => {
    const ref = String(body.user ?? body.user_id ?? body.reference ?? "").trim();
    const amountTzs = Math.round(Number(body.amount_tzs ?? body.amount));
    const phone = String(body.phone ?? "").replace(/[^\d]/g, "");
    const bankCode = String(body.bank_code ?? "").trim().toUpperCase();
    const accountNumber = String(body.account_number ?? "").replace(/[^\d]/g, "");

    if (!ref) return sendFail(fail("user_required", "Name the customer with `user`."));
    if (!Number.isFinite(amountTzs) || amountTzs <= 0) {
      return sendFail(fail("bad_amount", "`amount_tzs` must be a positive number of shillings."));
    }
    if (!phone && !(bankCode && accountNumber)) {
      return sendFail(fail("destination_required",
        "Send either `phone`, or both `bank_code` and `account_number`."));
    }

    const customer = await partnerCustomer(caller.partner.id, ref);
    if (!customer) {
      return sendFail(fail("unknown_customer", "No customer of yours matches that.", 404));
    }

    const { kycRefusal } = await import("@/lib/auth");
    const refusal = kycRefusal(customer, "withdraw");
    if (refusal) return sendFail({ ok: false, ...refusal, status: 403 });

    const { spendableTzs, executePayout } = await import("@/lib/payout");
    const funds = await spendableTzs(customer.id);
    if (amountTzs > funds.totalTzs) {
      return sendFail(fail("insufficient_balance",
        `That customer holds ${Math.floor(funds.totalTzs).toLocaleString()} TZS.`, 409));
    }

    const dest = bankCode ? { bankCode, accountNumber } : { phoneNumber: phone };
    const label = bankCode ? `${bankCode} account ending ${accountNumber.slice(-4)}` : phone;

    const { payoutCapacityTzs } = await import("@/lib/ntzsFunding");
    const capacity = await payoutCapacityTzs();
    if (capacity !== null && amountTzs > capacity) {
      const { db, migrate } = await import("@/lib/db");
      await migrate();
      const sql = db();
      const [queued] = await sql<{ id: string }[]>`
        insert into capx.withdrawal_queue (user_id, amount_tzs, destination)
        values (${customer.id}::uuid, ${amountTzs}, ${sql.json({ ...dest, label } as never)})
        returning id::text`;
      return send({ ok: true, status: "queued", withdrawal_id: queued.id,
        note: "Accepted and queued — the float is short of shillings right now. "
            + "It is sent automatically, oldest first, and the balance stays the customer's "
            + "until it goes out." }, 202);
    }

    try {
      const result = await executePayout({
        userId: customer.id, amountTzs, dest, label,
        key: `partner:${caller.partner.id}:${Date.now()}`,
      });
      return send({ ok: true, status: "sent", withdrawal_id: result.ref,
        rail_status: result.status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The payout did not go through.";
      return sendFail(fail("withdrawal_failed", msg, 502));
    }
  },
);
