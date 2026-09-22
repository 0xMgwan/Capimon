import "server-only";
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { db, migrate } from "./db";

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

/**
 * Password auth for custodial accounts.
 *
 * scrypt from node's own crypto — memory-hard, no dependency, and the
 * parameters are stored alongside the hash so they can be raised later without
 * invalidating existing passwords.
 */
const SCRYPT_KEYLEN = 64;
const SESSION_DAYS = 30;
const SESSION_COOKIE = "capx_session";

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  // Constant time — a fast reject leaks which prefix matched.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Re-exported so existing server callers keep working while the rule itself
// lives somewhere the sign-up form can also read it.
export { passwordProblem } from "./passwordRule";

export type SessionUser = {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  phone: string | null;
  country: string;
  avatar: string | null;
  ntzsUserId: string | null;
  kycStatus: string;
  nidaNumber: string | null;
};

export async function createSession(userId: string) {
  await migrate();
  const sql = db();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await sql`insert into capx.sessions (token, user_id, expires_at) values (${token}, ${userId}, ${expires})`;

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await migrate();
      await db()`delete from capx.sessions where token = ${token}`;
    } catch { /* the cookie still goes */ }
  }
  jar.delete(SESSION_COOKIE);
}

/** Resolves the signed-in custodial user, or null. Never throws. */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    await migrate();
    const rows = await db()<SessionUser[]>`
      select u.id, u.email, u.username, u.name, u.phone, u.country, u.avatar,
             u.ntzs_user_id as "ntzsUserId", u.kyc_status as "kycStatus",
             u.nida_number as "nidaNumber"
        from capx.sessions s
        join capx.users u on u.id = s.user_id
       where s.token = ${token} and s.expires_at > now()
       limit 1`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a customer may do something that moves money or securities.
 *
 * Verification was only ever a prompt on the page, so an account that
 * dismissed it — or a script that never saw it — could buy, sell, deposit and
 * withdraw unverified. This is the check every such route now makes, in one
 * place so the next route cannot quietly omit it.
 *
 * Two actions are deliberately not gated. Selling, because a holder reducing
 * a position lowers everyone's exposure and refusing it would trap the assets
 * of someone whose verification lapsed after they bought. And funding, because
 * a customer can top up while their verification is reviewed — their shillings
 * sit in their balance, and the first thing they cannot do with them is buy.
 * Buying and taking money out both need an approved verification.
 */
export type GatedAction = "buy" | "withdraw";

export function kycRefusal(
  user: { kycStatus?: string | null } | null,
  action: GatedAction,
): { code: string; error: string } | null {
  const status = user?.kycStatus ?? "none";
  if (status === "approved") return null;

  const what = action === "buy" ? "buy shares" : "withdraw";
  const reason = status === "pending"
    ? `Your verification is still being reviewed. You can ${what} as soon as it is approved.`
    : status === "rejected"
      ? `Your verification was not accepted, so you cannot ${what} yet. Submit it again from your account.`
      : `Verify your identity before you ${what}. It takes a few minutes from your account.`;
  return { code: `kyc_${status}`, error: reason };
}
