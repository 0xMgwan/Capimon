import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { ViewerRole } from "./adminAuth";

/**
 * A short-lived permit to look at one document.
 *
 * An `<img src>` carries no headers, so every other route could be moved to
 * bearer auth and these two could not: showing a reviewer an identity
 * document meant putting a desk token in a URL, where it lands in browser
 * history, in a download manager's list, in any referrer the page sends and
 * in every access log in between. The token that leaks that way opens the
 * whole estate, and it does not expire.
 *
 * A grant is the smallest thing that can replace it. It names one document
 * and one side of it, it stops working within minutes, and it is worth
 * nothing anywhere else — a leaked grant is a leaked glance at one picture
 * somebody was already entitled to see, rather than the keys to the desk.
 *
 * ## Why the key is the role's own token
 *
 * There is no general signing secret in this deployment and adding one means
 * another value to configure, store and rotate. Deriving the key from the
 * token of the role that minted the grant costs nothing to set up and buys a
 * property worth having: rotating a desk token invalidates every grant minted
 * under it, immediately and without anybody remembering to. The token itself
 * is never in the grant — only an HMAC taken under a key derived from it,
 * which cannot be run backwards.
 *
 * Each role keys its own grants, so FIMCO rotating its token cannot cut off
 * admin, and a grant minted by one role cannot be verified as another.
 */

/** Long enough to review a queue, short enough that a leaked URL is stale. */
export const TTL_MS = 10 * 60_000;

/** Bumping this invalidates every outstanding grant. */
const SCOPE = "capx.image-grant.v1";

/** Which side of a submission a grant is for. */
export type Which = "doc" | "selfie";

const b64url = (b: Buffer) => b.toString("base64url");

/**
 * The signing key for a role, derived rather than stored.
 *
 * An empty token yields no key at all rather than a key over the empty
 * string: a deployment that has not configured a role must mint nothing and
 * verify nothing, instead of having every grant for that role signed under a
 * value an attacker also knows.
 */
export function keyFor(roleToken: string): Buffer | null {
  if (!roleToken) return null;
  return createHmac("sha256", roleToken).update(SCOPE).digest();
}

type Claims = { role: ViewerRole; id: string; which: Which; exp: number };

/* Fields are joined with a character none of them may contain, and each is
   checked on the way back in — a role from a fixed set, an id that is a uuid,
   a side that is one of two words, an expiry that is digits. Without that a
   crafted id could carry a separator and move the boundary between fields. */
const SEP = "|";
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const ROLES: ViewerRole[] = ["admin", "fimco", "dse"];

const payloadOf = (c: Claims) => [c.role, c.id, c.which, String(c.exp)].join(SEP);

/**
 * Mints a grant. Null when the role has no token configured.
 *
 * `exp` is absolute rather than a duration so that verification needs nothing
 * but the grant and a clock — there is no issued-at to trust and no window to
 * recompute.
 */
export function signGrant(
  claims: Omit<Claims, "exp">, roleToken: string, now = Date.now(),
): string | null {
  const key = keyFor(roleToken);
  if (!key) return null;
  if (!isUuid(claims.id)) return null;
  const payload = payloadOf({ ...claims, exp: now + TTL_MS });
  const sig = createHmac("sha256", key).update(payload).digest();
  return `${b64url(Buffer.from(payload, "utf8"))}.${b64url(sig)}`;
}

export type GrantCheck =
  | { ok: true; role: ViewerRole }
  | { ok: false; reason: "malformed" | "unknown_role" | "not_configured" | "bad_signature" | "expired" | "wrong_document" };

/**
 * Checks a grant against the document actually being asked for.
 *
 * `want` is not optional and is not advisory. A grant that verifies but was
 * minted for a different document would otherwise let any holder of one
 * permit read every submission by editing the id in the URL — which is the
 * whole failure this replaces, reintroduced with extra steps.
 *
 * The role is read from the payload before the signature can be checked,
 * because the key depends on it. That is safe only because the role is then
 * used for one thing — selecting which token to derive the key from — so a
 * forged role simply derives a key the attacker cannot sign under, and the
 * signature check fails. Nothing is authorised on the strength of the
 * unverified field.
 */
export function checkGrant(
  grant: string,
  want: { id: string; which: Which },
  tokenForRole: (role: ViewerRole) => string,
  now = Date.now(),
): GrantCheck {
  const dot = grant.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };

  let payload: string;
  try {
    payload = Buffer.from(grant.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const parts = payload.split(SEP);
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [role, id, which, exp] = parts;

  if (!ROLES.includes(role as ViewerRole)) return { ok: false, reason: "unknown_role" };
  if (!isUuid(id)) return { ok: false, reason: "malformed" };
  if (which !== "doc" && which !== "selfie") return { ok: false, reason: "malformed" };
  if (!/^\d+$/.test(exp)) return { ok: false, reason: "malformed" };

  const key = keyFor(tokenForRole(role as ViewerRole));
  if (!key) return { ok: false, reason: "not_configured" };

  const expected = createHmac("sha256", key).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(grant.slice(dot + 1), "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  /* Length first: timingSafeEqual throws on a mismatch rather than returning
     false, and a thrown comparison is a failure that reads as a crash. */
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  /* Expiry and the document are checked only after the signature, so an
     unsigned guess learns nothing from which answer it gets. */
  if (Number(exp) <= now) return { ok: false, reason: "expired" };
  if (id !== want.id || which !== want.which) return { ok: false, reason: "wrong_document" };

  return { ok: true, role: role as ViewerRole };
}
