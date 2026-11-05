import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/**
 * Moving shares between accounts on a customer's behalf.
 *
 * The sender must be one of yours — a partner can only move what their own
 * customer holds, and scoping it on the way in means no ordering of these
 * lines lets one partner spend another's book.
 *
 * The recipient does not have to be. Shares reaching a CAPX account the
 * partner did not introduce is the ordinary case, and refusing it would make
 * the feature useless: people send things to people, not to customers of the
 * same app. They are named by email or handle, must already exist, and must
 * be verified.
 *
 * Nothing is bought or sold and nothing leaves custody. The same shares stay
 * with the same custodian and the claim on them moves, which is why both
 * boards work the same way here — a DSE security and a US equity are both
 * just a claim in the ledger until somebody withdraws one.
 */
export const POST = partnerRoute(
  "POST /v1/transfers",
  { movesMoney: true, idempotent: true },
  async ({ caller, body }) => {
    const fromRef = String(body.from ?? body.user ?? "").trim();
    const to = String(body.to ?? "").trim();
    const security = String(body.security ?? body.symbol ?? "").trim();
    const qty = Number(body.qty ?? body.amount);

    if (!fromRef) return sendFail(fail("from_required", "Name the sender with `from`."));
    if (!to) {
      return sendFail(fail("to_required",
        "Name the recipient with `to` — their CAPX email or @handle, or your own reference "
        + "for one of your customers."));
    }
    if (!security) return sendFail(fail("security_required", "Name the security."));

    const sender = await partnerCustomer(caller.partner.id, fromRef);
    if (!sender) {
      return sendFail(fail("unknown_customer",
        "No customer of yours matches that sender.", 404));
    }

    /* Your own reference first, then any CAPX account by email or handle. */
    const { findRecipient, transferShares } = await import("@/lib/transfers");
    const mine = await partnerCustomer(caller.partner.id, to);
    const recipient = mine ? { id: mine.id, email: mine.email, name: mine.name,
                               username: mine.username }
                           : await findRecipient(to);
    if (!recipient) {
      return sendFail(fail("unknown_recipient",
        "No CAPX account matches that recipient.", 404));
    }

    const result = await transferShares({
      fromUserId: sender.id,
      toUserId: recipient.id,
      security,
      qty,
      note: body.note ? String(body.note) : undefined,
    });

    if (!result.ok) {
      const { status, ok, ...rest } = result; void ok;
      return send({ ok: false, ...rest }, status);
    }

    const { emit } = await import("@/lib/partners");
    void emit(caller.partner.id, "shares.transferred", {
      transfer_id: result.transferId, security: result.security, qty: result.qty,
      from: sender.id, to: recipient.id, reference: fromRef,
    }).catch(() => {});

    return send({
      ok: true,
      transfer: {
        id: result.transferId,
        security: result.security,
        qty: result.qty,
        from: sender.id,
        to: recipient.id,
        /*
         * The sender's average cost travels with the shares: a gift is not a
         * disposal, so they realise nothing and the recipient's P&L continues
         * from where theirs left off. Null when the sender had no recorded
         * basis, in which case the shares arrive with none.
         */
        inherited_cost: result.inheritedCost,
        cost_currency: result.currency,
      },
    }, 201);
  },
);
