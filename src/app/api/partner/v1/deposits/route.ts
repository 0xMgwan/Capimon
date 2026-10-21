import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * A customer's funding history.
 *
 * Reading is available; starting a collection is not, and the reason is worth
 * stating rather than hiding behind a 404.
 *
 * Choosing a deposit rail is about two hundred lines living inside the
 * customer-facing route: it picks between the ramp, a wallet collection and a
 * bank transfer depending on which nTZS capabilities are granted, each with
 * its own minimum and its own failure handling. Copying that here to serve
 * partners would be a second implementation of the path money arrives on, and
 * the day the two drifted apart the difference would be somebody's deposit.
 *
 * The fix is to lift that logic into a library the way the payout path was
 * lifted into lib/payout.ts, and have both routes call it. Until that is
 * done, POST answers plainly instead of pretending.
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

export const POST = partnerRoute("POST /v1/deposits", { movesMoney: true }, async () =>
  sendFail(fail("not_implemented",
    "Partner-initiated deposits are not available yet. Rail selection lives inside the "
    + "customer-facing deposit route and will be lifted into a shared library before it is "
    + "exposed here — copying it would create a second path for money arriving. Until then, "
    + "fund a customer through the CAPX app, or talk to us about a bulk settlement account.",
    501)));
