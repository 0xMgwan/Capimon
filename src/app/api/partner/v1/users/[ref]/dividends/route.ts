import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Dividends and corporate actions credited to one customer.
 *
 * Neither board pays cash into a balance. A tokenised US equity reflects a
 * dividend by raising the token's multiplier, so the holder's share count
 * grows rather than their cash; CAPX reads that multiplier and credits the
 * difference to whoever held the claim, which is what these rows are. A DSE
 * security does the same through its own corporate-action pass.
 *
 * So the honest shape is shares, not shillings, and the entry says which
 * multiplier produced it. A partner showing "dividend received" to their
 * customer should show the shares.
 */
export const GET = partnerRoute("GET /v1/users/:ref/dividends", {}, async ({ caller, req }) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const ref = decodeURIComponent(parts[parts.length - 2] ?? "");
  const customer = await partnerCustomer(caller.partner.id, ref);
  if (!customer) return sendFail(fail("unknown_customer", "No customer of yours matches that.", 404));

  await migrate();
  const rows = await db()<{ asset: string; amount: string; ref: string | null;
                            metadata: Record<string, unknown>; created_at: string }[]>`
    select asset, amount::text, ref, metadata, created_at
      from capx.ledger_entries
     where user_id = ${customer.id}::uuid
       and (kind = 'adjustment' and ref like 'corp:%')
     order by created_at desc limit 200`;

  return send({ ok: true, user_id: customer.id, dividends: rows.map((r) => ({
    security: r.asset,
    shares_credited: Number(r.amount),
    multiplier: r.metadata?.multiplier ?? null,
    kind: "corporate_action",
    reference: r.ref,
    created_at: r.created_at,
  })) });
});
