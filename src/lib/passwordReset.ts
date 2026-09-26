import "server-only";
import { randomBytes, createHash } from "crypto";
import { db, dbConfigured, migrate } from "./db";
import { hashPassword, passwordProblem } from "./auth";
import { sendMail, mailConfigured } from "./mail";
import { brandedEmail } from "./mailTemplate";

/**
 * Getting back into an account you are locked out of.
 *
 * The whole flow turns on one question — does this person read that inbox —
 * and everything here exists to answer it without answering any other. Three
 * rules follow from that:
 *
 * The token is a secret we hand over and then forget. Only its SHA-256 is
 * stored, so somebody holding a dump of this table holds nothing they can use.
 *
 * Asking never reveals whether an account exists. A reset form that says "no
 * such email" is a free tool for working out who banks here, so the reply is
 * the same either way and the difference is only ever in the inbox.
 *
 * Setting a new password ends every other session. Most resets happen because
 * somebody else has the old one; leaving that person signed in would make the
 * reset ceremonial.
 */

const TTL_MINUTES = 60;
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.capx.broker";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Issues a reset for whoever owns this email or handle, and mails it.
 *
 * Returns nothing about who that was. The caller answers the same way whether
 * or not anybody matched.
 */
export async function requestReset(identifier: string): Promise<void> {
  const id = identifier.trim().toLowerCase();
  if (!id || !dbConfigured) return;
  await migrate();
  const sql = db();

  const [user] = await sql<{ id: string; email: string; name: string | null }[]>`
    select id::text, email, name from capx.users
     where lower(email) = ${id} or lower(username) = ${id.replace(/^@/, "")}
     limit 1`;
  if (!user) return;

  /*
   * One live ticket at a time.
   *
   * Asking twice because the first mail was slow should not leave two working
   * links in an inbox — the newest is the one the person is looking at, and
   * the older one is now just an unexpired key lying around.
   */
  await sql`
    update capx.password_resets set used_at = now()
     where user_id = ${user.id}::uuid and used_at is null and expires_at > now()`;

  const token = randomBytes(32).toString("base64url");
  await sql`
    insert into capx.password_resets (user_id, token_hash, expires_at)
    values (${user.id}::uuid, ${digest(token)}, now() + make_interval(mins => ${TTL_MINUTES}))`;

  const link = `${SITE}/reset?token=${token}`;
  const first = user.name?.trim().split(/\s+/)[0];

  await sendMail({
    to: user.email,
    subject: "Reset your CAPX password",
    text:
      `${first ? `Hi ${first},` : "Hi,"}\n\n` +
      `Someone asked to reset the password on your CAPX account. Open the link below to choose a new one:\n\n` +
      `${link}\n\n` +
      `The link works once and expires in ${TTL_MINUTES} minutes. Signing in with a new password ends any other ` +
      `sessions on the account.\n\n` +
      `If this was not you, nothing has changed and you can ignore this email — your current password still works.\n\n` +
      `— CAPX`,
    html: brandedEmail({
      heading: "Reset your password",
      paragraphs: [
        `${first ? `Hi ${first}. ` : ""}Someone asked to reset the password on your CAPX account.`,
        `The link below works once and expires in ${TTL_MINUTES} minutes. Choosing a new password also signs out anyone else who was using the old one.`,
      ],
      cta: { label: "Choose a new password", href: link },
      note: "If this was not you, ignore this email. Nothing has changed and your current password still works.",
    }),
  });
}

/**
 * Spends a token and sets the password.
 *
 * The refusals are deliberately indistinguishable from each other: expired,
 * already used and never existed all read as one message, because telling a
 * stranger which of those it was tells them something about the account.
 */
export async function consumeReset(
  token: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!dbConfigured) return { ok: false, error: "Accounts are not available on this deployment." };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  await migrate();
  const sql = db();

  /*
   * Claimed in the update, not checked and then claimed.
   *
   * Two requests carrying the same link would both pass a separate read, and
   * only one row can come back from this one — so the second is refused by
   * the database rather than by a race.
   */
  const [row] = await sql<{ user_id: string }[]>`
    update capx.password_resets set used_at = now()
     where token_hash = ${digest(token.trim())} and used_at is null and expires_at > now()
    returning user_id::text`;

  if (!row) {
    return { ok: false, error: "That link has expired or has already been used. Ask for a new one." };
  }

  await sql`
    update capx.users set password_hash = ${await hashPassword(password)} where id = ${row.user_id}::uuid`;

  // Everything signed in with the old password stops being signed in.
  await sql`delete from capx.sessions where user_id = ${row.user_id}::uuid`;

  return { ok: true };
}

/** Whether a reset can actually be delivered, for the form to say so honestly. */
export const resetConfigured = mailConfigured;
