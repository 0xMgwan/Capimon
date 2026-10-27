import "server-only";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { db, dbConfigured, migrate } from "./db";

/**
 * Letting an existing CAPX customer use a partner, with their consent.
 *
 * Creating a customer refuses an email already on CAPX, and has to: adopting
 * an account because a caller named its address would hand that caller
 * somebody else's balance, holdings and history. A typo would be enough.
 *
 * So the account holder decides, in a channel the partner does not control.
 * The partner asks, CAPX emails the person a short code, and the link exists
 * only once they have typed it back into the partner's app. That is the whole
 * mechanism, and its strength is that the code travels to the customer rather
 * than through the partner.
 *
 * What a link is not: it does not move the customer to the partner. It grants
 * access, it can be revoked by either side, and the same person can have
 * several — being reachable from NEDApay should not stop somebody reaching
 * their own account from anywhere else.
 */

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

const hashCode = (code: string) => createHash("sha256").update(code.trim()).digest("hex");

/** Six digits, from a generator fit for the purpose. */
const mintCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export type LinkRequest =
  | { ok: true; status: "pending_consent"; expires_at: string; email_hint: string }
  | { ok: true; status: "already_linked"; user_id: string }
  | { ok: false; code: string; error: string; status: number };

/**
 * Asks a CAPX account holder to let this partner act for them.
 *
 * Answers the same way whether or not the email belongs to anybody. A partner
 * who can discover which addresses have CAPX accounts by watching the
 * response has been handed a list of customers they were never given, so the
 * reply is identical either way and the email is simply not sent.
 */
export async function requestLink(input: {
  partnerId: string; partnerName: string; email: string; reference: string;
}): Promise<LinkRequest> {
  if (!dbConfigured) {
    return { ok: false, code: "not_configured", error: "No database.", status: 503 };
  }
  const email = input.email.trim().toLowerCase();
  const reference = input.reference.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, code: "bad_email", error: "A valid email is required.", status: 400 };
  }
  if (!reference) {
    return { ok: false, code: "reference_required",
      error: "Send your own id for this customer as `reference`.", status: 400 };
  }

  await migrate();
  const sql = db();

  const hint = email.replace(/^(.).*(@.*)$/, "$1…$2");
  const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const [user] = await sql<{ id: string; name: string | null; partner_id: string | null }[]>`
    select id::text, name, partner_id::text from capx.users where lower(email) = ${email}`;

  /* No account: answered exactly as a real one is, and nothing is sent. */
  if (!user) return { ok: true, status: "pending_consent", expires_at: expires, email_hint: hint };

  /* Already theirs, by introduction or by an earlier link. */
  if (user.partner_id === input.partnerId) {
    return { ok: true, status: "already_linked", user_id: user.id };
  }
  const [live] = await sql<{ id: string }[]>`
    select id::text from capx.partner_links
     where partner_id = ${input.partnerId}::uuid and user_id = ${user.id}::uuid
       and status = 'active'`;
  if (live) return { ok: true, status: "already_linked", user_id: user.id };

  const code = mintCode();
  await sql`
    insert into capx.partner_links
      (partner_id, user_id, reference, status, code_hash, expires_at, requested_by)
    values (${input.partnerId}::uuid, ${user.id}::uuid, ${reference}, 'pending',
            ${hashCode(code)}, ${expires}, ${input.partnerName})
    on conflict (partner_id, user_id) where status <> 'revoked'
    do update set reference = excluded.reference, code_hash = excluded.code_hash,
                  expires_at = excluded.expires_at, attempts = 0, status = 'pending'`;

  const { sendMail } = await import("./mail");
  await sendMail({
    to: email,
    subject: `${input.partnerName} wants to connect to your CAPX account`,
    text:
      `${user.name ? user.name + "," : "Hello,"}\n\n` +
      `${input.partnerName} has asked to connect to your CAPX account. If you are setting this ` +
      `up right now, your code is:\n\n    ${code}\n\n` +
      `Type it into ${input.partnerName} to confirm. It lasts fifteen minutes.\n\n` +
      `Once connected, ${input.partnerName} can see your balances and holdings and can buy and ` +
      `sell on your behalf. They cannot change your password or withdraw to an account you have ` +
      `not set up. You can disconnect them at any time from your CAPX settings.\n\n` +
      `If you did not ask for this, ignore this email and nothing happens. Nobody can connect ` +
      `without this code, and we will never ask you for it.`,
  }).catch(() => { /* the row stands; they can ask again */ });

  return { ok: true, status: "pending_consent", expires_at: expires, email_hint: hint };
}

export type LinkConfirm =
  | { ok: true; user_id: string; reference: string }
  | { ok: false; code: string; error: string; status: number };

/**
 * Completes a link when the customer gives the partner their code.
 *
 * Attempts are counted and the code dies after five, because six digits is
 * only a secret while guessing is expensive. A wrong code and an expired one
 * are answered the same way: the difference tells a guesser whether they have
 * found a live request, which is exactly what they want to know.
 */
export async function confirmLink(input: {
  partnerId: string; email: string; code: string;
}): Promise<LinkConfirm> {
  await migrate();
  const sql = db();
  const email = input.email.trim().toLowerCase();
  const refuse = { ok: false as const, code: "bad_code",
    error: "That code is wrong or has expired. Ask for a new one.", status: 409 };

  const [row] = await sql<{ id: string; user_id: string; reference: string;
                            code_hash: string | null; expires_at: string;
                            attempts: number; status: string }[]>`
    select l.id::text, l.user_id::text, l.reference, l.code_hash, l.expires_at::text,
           l.attempts, l.status
      from capx.partner_links l
      join capx.users u on u.id = l.user_id
     where l.partner_id = ${input.partnerId}::uuid and lower(u.email) = ${email}
       and l.status = 'pending'`;
  if (!row?.code_hash) return refuse;

  if (row.attempts >= MAX_ATTEMPTS) {
    await sql`update capx.partner_links set status = 'expired' where id = ${row.id}::uuid`;
    return refuse;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await sql`update capx.partner_links set status = 'expired' where id = ${row.id}::uuid`;
    return refuse;
  }

  const given = Buffer.from(hashCode(String(input.code ?? "")));
  const want = Buffer.from(row.code_hash);
  const match = given.length === want.length && timingSafeEqual(given, want);
  if (!match) {
    await sql`update capx.partner_links set attempts = attempts + 1 where id = ${row.id}::uuid`;
    return refuse;
  }

  await sql`
    update capx.partner_links
       set status = 'active', consented_at = now(), code_hash = null
     where id = ${row.id}::uuid`;

  return { ok: true, user_id: row.user_id, reference: row.reference };
}

/** Every partner a customer has let in, for their own settings page. */
export async function linksForUser(userId: string) {
  if (!dbConfigured) return [];
  await migrate();
  return db()<{ id: string; partner: string; reference: string;
                consented_at: string | null; status: string }[]>`
    select l.id::text, p.name as partner, l.reference, l.consented_at::text, l.status
      from capx.partner_links l join capx.partners p on p.id = l.partner_id
     where l.user_id = ${userId}::uuid and l.status = 'active'
     order by l.consented_at desc`;
}

/**
 * Withdraws a partner's access.
 *
 * Either side can do it and neither needs the other's agreement: a customer
 * who wants a partner out should not have to ask that partner to let them go.
 */
export async function revokeLink(linkId: string, by: string, userId?: string) {
  await migrate();
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    update capx.partner_links
       set status = 'revoked', revoked_at = now(), revoked_by = ${by}
     where id = ${linkId}::uuid and status <> 'revoked'
       and (${userId ?? null}::uuid is null or user_id = ${userId ?? null}::uuid)
     returning id::text`;
  return rows.length > 0;
}
