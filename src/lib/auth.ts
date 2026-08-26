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
const SESSION_COOKIE = "capimon_session";

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

/** Passwords guarding custody of other people's assets deserve a real floor. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Use at least one letter and one number.";
  }
  return null;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  country: string;
  ntzsUserId: string | null;
  kycStatus: string;
};

export async function createSession(userId: string) {
  await migrate();
  const sql = db();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await sql`insert into sessions (token, user_id, expires_at) values (${token}, ${userId}, ${expires})`;

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
      await db()`delete from sessions where token = ${token}`;
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
      select u.id, u.email, u.name, u.phone, u.country,
             u.ntzs_user_id as "ntzsUserId", u.kyc_status as "kycStatus"
        from sessions s
        join users u on u.id = s.user_id
       where s.token = ${token} and s.expires_at > now()
       limit 1`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
