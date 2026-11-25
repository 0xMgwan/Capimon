import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";
import { claimBankDeposit } from "@/lib/deposits";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Confirms one of your customers' bank transfers with their receipt.
 *
 * A bank push is the only funding route where nobody can see the money
 * coming. Nothing is prompted and nothing is pulled: the customer types a
 * reference into their banking app, and that reference does not survive the
 * rail — banks and Selcom wallets drop the narration, so the credit is matched
 * off a statement rather than on arrival. Minutes at best, and a person's
 * attention when it cannot be matched at all.
 *
 * The receipt on your customer's payment confirmation identifies it exactly.
 * Collect it in your own app, send it here, and the shillings mint in seconds.
 *
 * Safe to repeat. `claim: "not_found"` is not a failure — it means the money
 * has not reached nTZS yet, and the only correct response is to ask again in
 * a minute. Never tell a customer to pay again on the strength of it.
 */
export const POST = partnerRoute("POST /v1/deposits/:id/claim", { movesMoney: true },
  async ({ caller, body, req }) => {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const depositId = decodeURIComponent(parts[parts.length - 2] ?? "");
    const receipt = String(body.receipt ?? "").trim();
    if (!receipt) {
      return sendFail(fail("receipt_required",
        "Send the Selcom receipt from your customer's payment confirmation as `receipt`."));
    }
    if (!/^[0-9a-f-]{36}$/i.test(depositId)) {
      return sendFail(fail("unknown_deposit", "No deposit of yours matches that.", 404));
    }

    /*
     * Whose deposit it is, checked here rather than inside the claim.
     *
     * The claim itself is scoped to a user id, and a partner is not one. This
     * is what turns "a deposit belonging to this customer" into "a deposit
     * belonging to a customer of yours" — without it, a partner holding any
     * key could confirm a stranger's transfer.
     */
    await migrate();
    const [row] = await db()<{ user_id: string; partner_ref: string | null }[]>`
      select d.user_id::text, u.partner_ref
        from capx.deposits d join capx.users u on u.id = d.user_id
       where d.id = ${depositId}::uuid and u.partner_id = ${caller.partner.id}::uuid`;
    if (!row) {
      return sendFail(fail("unknown_deposit", "No deposit of yours matches that.", 404));
    }
    const customer = await partnerCustomer(caller.partner.id, row.user_id);
    if (!customer) {
      return sendFail(fail("unknown_deposit", "No deposit of yours matches that.", 404));
    }

    const result = await claimBankDeposit({
      userId: row.user_id, depositId, receipt,
    });
    if (!result.ok) {
      const { status, ok, ...rest } = result;
      void ok;
      return send({ ok: false, ...rest }, status);
    }

    const claimed = "claim" in result ? result.claim : "credited";
    return send({
      ok: true,
      deposit: {
        id: depositId, user_id: row.user_id, reference: row.partner_ref,
        route: "bank", status: result.status, claim: claimed,
      },
      note: "note" in result ? result.note : null,
      /* 202 while the money is still on its way to nTZS, so a caller that
         switches on the status does not read "not yet" as "done". */
    }, claimed === "not_found" ? 202 : 200);
  },
);
