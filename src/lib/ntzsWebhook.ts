import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Whether a delivery really came from nTZS.
 *
 * Its own file, and taking its inputs rather than reading them, because this
 * is the whole of the security boundary on that route: everything downstream
 * credits money on the strength of it. A function that reaches for
 * `process.env` and `Date.now()` is a function that cannot be tested, and an
 * untested signature check is one that passes everything the day somebody
 * changes it.
 *
 * HMAC-SHA256 over `"<timestamp>.<raw body>"`, hex, as the nTZS webhook
 * reference specifies. Over the raw bytes — parsing and re-serialising would
 * check a different string than the one that was signed, and would start
 * failing the first time nTZS changed its key order.
 */

/** Five minutes, as the nTZS docs specify, to bound replay of a signed body. */
export const TOLERANCE_S = 300;

export function verifySignature(input: {
  raw: string;
  signature: string;
  timestamp: string;
  secret: string;
  now?: number;
}): boolean {
  const { raw, signature, timestamp, secret } = input;
  if (!secret || !signature || !timestamp) return false;

  /* A missing secret must never mean "accept everything". An unconfigured
     deployment refuses deliveries, and the sweep keeps crediting. */
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  const age = Math.abs((input.now ?? Date.now()) / 1000 - seconds);
  if (age > TOLERANCE_S) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");

  /* Length first: timingSafeEqual throws on a mismatch, and the throw would
     itself be the comparison leaking. */
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
