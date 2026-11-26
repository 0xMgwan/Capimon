/**
 * Validating an ISIN properly, which means its check digit.
 *
 * The CSD identifies a security by this and nothing else, so a wrong one is
 * not a typo that fails — it is a pledge instruction placed against somebody
 * else's security, accepted, and discovered later. On the Dar es Salaam board
 * the codes differ by a digit or two in the middle (CRDB is TZ1996100305 and
 * DCB is TZ1996100214), which is exactly the shape a transposition survives.
 *
 * The last character is a check digit computed over the rest, so a single
 * wrong or transposed character almost always fails it. Checking the format
 * alone would accept every one of them.
 */

/** Letters count as their position plus nine: A is 10, Z is 35. */
const expand = (s: string): string => {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  return out;
};

/**
 * The Luhn check digit for an ISIN's first eleven characters.
 *
 * Doubling starts from the rightmost digit of the expanded string, which is
 * the detail most implementations get backwards — and getting it backwards
 * still produces a digit between 0 and 9, so it fails silently on about nine
 * codes in ten rather than loudly on all of them.
 */
export function isinCheckDigit(first11: string): number {
  const digits = expand(first11.toUpperCase());
  let sum = 0;
  let double = true; // the rightmost digit is doubled
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export type IsinCheck =
  | { ok: true; isin: string }
  | { ok: false; reason: string };

/** Whether this is a real ISIN, not merely an ISIN-shaped string. */
export function checkIsin(raw: string): IsinCheck {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!v) return { ok: false, reason: "An ISIN is required." };
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v)) {
    return {
      ok: false,
      reason: `"${raw.trim()}" is not an ISIN. Expected two letters, nine characters and a check digit — TZ1996100305.`,
    };
  }
  const want = isinCheckDigit(v.slice(0, 11));
  const got = v.charCodeAt(11) - 48;
  if (want !== got) {
    return {
      ok: false,
      reason: `"${v}" fails its own check digit — it should end in ${want}. `
        + `That usually means a character is wrong or two were swapped.`,
    };
  }
  return { ok: true, isin: v };
}
