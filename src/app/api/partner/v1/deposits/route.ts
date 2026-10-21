import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Funding a partner's customer, and reading what has already landed.
 *
 * The rail choice — ramp, wallet collection or bank transfer, each with its
 * own minimum and its own failure handling — lives in lib/deposits.ts and is
 * called here unchanged. There is one path for money arriving, and a partner
 * uses it rather than a copy of it.
 *
 * What a partner cannot do, and will not be given, is credit a balance
 * directly. A balance that can be written without money arriving is not a
 * balance, and every solvency guarantee downstream rests on the difference.
 */
export const GET = partnerRoute("GET /v1/deposits", {}, async ({ caller, req }) => {
  const u = new URL(req.url);
  const ref = (u.searchParams.get("user") ?? "").trim();

  await migrate();
  const sql = db();
  const rows = ref
    ? await (async () => {
        const customer = await partnerCustomer(caller.partner.id, ref);
        if (!customer) return [];
        return sql<DepositRow[]>`
          select d.id::text, d.amount_tzs::text, d.status, d.usdc_credited::text,
                 d.created_at, d.settled_at, u.partner_ref, u.id::text as user_id
            from capx.deposits d join capx.users u on u.id = d.user_id
           where d.user_id = ${customer.id}::uuid
           order by d.created_at desc limit 100`;
      })()
    : await sql<DepositRow[]>`
        select d.id::text, d.amount_tzs::text, d.status, d.usdc_credited::text,
               d.created_at, d.settled_at, u.partner_ref, u.id::text as user_id
          from capx.deposits d join capx.users u on u.id = d.user_id
         where u.partner_id = ${caller.partner.id}::uuid
         order by d.created_at desc limit 100`;

  return send({ ok: true, deposits: rows.map((r) => ({
    id: r.id, user_id: r.user_id, reference: r.partner_ref,
    amount_tzs: Number(r.amount_tzs), status: r.status,
    usdc_credited: r.usdc_credited === null ? null : Number(r.usdc_credited),
    created_at: r.created_at, settled_at: r.settled_at,
  })) });
});

type DepositRow = {
  id: string; amount_tzs: string; status: string; usdc_credited: string | null;
  created_at: string; settled_at: string | null; partner_ref: string | null; user_id: string;
};

/**
 * Starts a collection from the customer's own mobile money, or returns the
 * bank details for them to push a transfer to.
 *
 * Mobile money prompts the phone and settles on its own. A bank transfer
 * returns a one-off reference and the account to pay into — nothing is taken
 * until the customer sends it, and the reference is what matches the money
 * back to them, so show it to them verbatim.
 */
export const POST = partnerRoute(
  "POST /v1/deposits",
  { movesMoney: true, idempotent: true },
  async ({ caller, body }) => {
    const ref = String(body.user ?? body.user_id ?? body.reference ?? "").trim();
    if (!ref) return sendFail(fail("user_required", "Name the customer with `user`."));

    const customer = await partnerCustomer(caller.partner.id, ref);
    if (!customer) {
      return sendFail(fail("unknown_customer", "No customer of yours matches that.", 404));
    }

    const method = String(body.method ?? "mobile_money") === "bank_transfer"
      ? "bank_transfer" as const : "mobile_money" as const;

    const { startDeposit } = await import("@/lib/deposits");
    const result = await startDeposit({
      userId: customer.id,
      amountTzs: Number(body.amount_tzs ?? body.amount),
      phoneNumber: String(body.phone ?? customer.phone ?? ""),
      method,
      payerAccountNumber: body.payer_account_number
        ? String(body.payer_account_number) : undefined,
    });

    if (!result.ok) {
      const { status, ok, ...rest } = result;
      void ok;
      return send({ ok: false, ...rest }, status);
    }

    const { emit } = await import("@/lib/partners");
    void emit(caller.partner.id, "deposit.started", {
      deposit_id: result.depositId, user_id: customer.id, reference: ref,
      amount_tzs: Number(body.amount_tzs ?? body.amount), route: result.route,
    }).catch(() => {});

    return send({
      ok: true,
      deposit: {
        id: result.depositId,
        user_id: customer.id,
        reference: ref,
        route: result.route,
        status: result.status,
        /* Present only on the bank route: what the customer must pay into. */
        bank: result.bank ?? null,
      },
      note: result.note ?? null,
    }, 202);
  },
);
