import { partnerRoute, send, sendFail, fail } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/**
 * Connecting to somebody who already has a CAPX account.
 *
 * Creating a customer refuses an email already on CAPX, because adopting an
 * account because a caller named its address would hand that caller somebody
 * else's balance. This is the consented route to the same place: CAPX emails
 * the account holder a code, and the link exists once they have typed it back
 * into your app.
 *
 * The code goes to the customer, not through you. That is the point of it,
 * and it is why this cannot be done on your assertion alone.
 */
export const POST = partnerRoute("POST /v1/users/link", { idempotent: true },
  async ({ caller, body }) => {
    const action = String(body.action ?? "request");

    if (action === "confirm") {
      const { confirmLink } = await import("@/lib/partnerLinks");
      const result = await confirmLink({
        partnerId: caller.partner.id,
        email: String(body.email ?? ""),
        code: String(body.code ?? ""),
      });
      if (!result.ok) {
        const { status, ok, ...rest } = result; void ok;
        return send({ ok: false, ...rest }, status);
      }

      const { emit } = await import("@/lib/partners");
      void emit(caller.partner.id, "customer.linked",
        { user_id: result.user_id, reference: result.reference }).catch(() => {});

      const { customerView } = await import("@/lib/partnerApi");
      return send({ ok: true, linked: true, user: await customerView(result.user_id) });
    }

    const { requestLink } = await import("@/lib/partnerLinks");
    const result = await requestLink({
      partnerId: caller.partner.id,
      partnerName: caller.partner.name,
      email: String(body.email ?? ""),
      reference: String(body.reference ?? ""),
    });
    if (!result.ok) {
      const { status, ok, ...rest } = result; void ok;
      return send({ ok: false, ...rest }, status);
    }
    if (result.status === "already_linked") {
      const { customerView } = await import("@/lib/partnerApi");
      return send({ ok: true, linked: true, user: await customerView(result.user_id) });
    }

    return send({
      ok: true,
      status: "pending_consent",
      expires_at: result.expires_at,
      email_hint: result.email_hint,
      note: "If that address has a CAPX account, its holder has been emailed a six-digit code. "
          + "Ask them for it and call this again with action: \"confirm\". "
          + "The same answer is returned whether or not an account exists, so this cannot be "
          + "used to discover who banks with CAPX.",
    }, 202);
  });

export const GET = partnerRoute("GET /v1/users/link", {}, async ({ caller }) => {
  const { db, migrate } = await import("@/lib/db");
  await migrate();
  const rows = await db()<{ id: string; reference: string; status: string;
                            consented_at: string | null; email: string }[]>`
    select l.id::text, l.reference, l.status, l.consented_at::text, u.email
      from capx.partner_links l join capx.users u on u.id = l.user_id
     where l.partner_id = ${caller.partner.id}::uuid and l.status = 'active'
     order by l.consented_at desc limit 200`;
  return send({ ok: true, links: rows });
});

/** Hands a customer back. Either side can end a link; neither needs the other. */
export const DELETE = partnerRoute("DELETE /v1/users/link", {}, async ({ caller, body }) => {
  const id = String(body.link_id ?? "");
  if (!id) return sendFail(fail("link_required", "Name the link with `link_id`."));
  const { revokeLink } = await import("@/lib/partnerLinks");
  const done = await revokeLink(id, caller.partner.name);
  return send({ ok: done });
});
