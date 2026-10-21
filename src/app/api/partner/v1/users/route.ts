import { partnerRoute, send, sendFail, fail, customerView } from "@/lib/partnerApi";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The partner's own customers, newest first. */
export const GET = partnerRoute("GET /v1/users", {}, async ({ caller }) => {
  await migrate();
  const rows = await db()<{ id: string }[]>`
    select id::text from capx.users
     where partner_id = ${caller.partner.id}::uuid
     order by created_at desc limit 200`;
  const users = await Promise.all(rows.map((r) => customerView(r.id)));
  return send({ ok: true, users: users.filter(Boolean) });
});

/**
 * Creates one of the partner's customers.
 *
 * An ordinary CAPX account, carrying the partner's id and their own reference
 * for the person. Everything downstream — the ledger, custody, solvency, the
 * refusals on an order — then treats them exactly as it treats a customer who
 * signed up here directly, which is the point.
 *
 * An email already on CAPX is refused rather than adopted. Quietly attaching
 * an existing account to a partner would hand that partner somebody else's
 * balance, and there is no version of this API where that is an acceptable
 * outcome of a typo.
 */
export const POST = partnerRoute("POST /v1/users", { idempotent: true }, async ({ caller, body }) => {
  const email = String(body.email ?? "").trim().toLowerCase();
  const reference = String(body.reference ?? "").trim();
  const name = body.name ? String(body.name).trim() : null;
  const phone = body.phone ? String(body.phone).replace(/[^\d+]/g, "") : null;
  const country = String(body.country ?? caller.partner.country ?? "TZ").toUpperCase().slice(0, 2);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return sendFail(fail("bad_email", "A valid email is required for each customer."));
  }
  if (!reference) {
    return sendFail(fail("reference_required",
      "Send your own id for this customer as `reference`, so both sides can reconcile without a mapping table."));
  }

  await migrate();
  const sql = db();

  const [mine] = await sql<{ id: string }[]>`
    select id::text from capx.users
     where partner_id = ${caller.partner.id}::uuid and partner_ref = ${reference}`;
  if (mine) return send({ ok: true, user: await customerView(mine.id), existing: true });

  const [taken] = await sql<{ partner_id: string | null }[]>`
    select partner_id::text from capx.users where lower(email) = ${email}`;
  if (taken) {
    return sendFail(fail("email_in_use",
      taken.partner_id === caller.partner.id
        ? "You already have a customer with that email under a different reference."
        : "That email already belongs to a CAPX account. Ask the customer to use a different one, "
          + "or have them sign in directly.",
      409));
  }

  /*
   * No password is set.
   *
   * The partner authenticates their customer; CAPX never does. A random hash
   * nobody holds means there is no credential to leak and no sign-in path
   * that bypasses the partner.
   */
  const { randomBytes, createHash } = await import("crypto");
  const unusable = createHash("sha256").update(randomBytes(32)).digest("hex");

  const [row] = await sql<{ id: string }[]>`
    insert into capx.users (email, password_hash, name, phone, country, partner_id, partner_ref)
    values (${email}, ${`partner:${unusable}`}, ${name}, ${phone}, ${country},
            ${caller.partner.id}::uuid, ${reference})
    returning id::text`;

  const { emit } = await import("@/lib/partners");
  void emit(caller.partner.id, "customer.created",
    { user_id: row.id, reference, email }).catch(() => {});

  return send({ ok: true, user: await customerView(row.id) }, 201);
});
