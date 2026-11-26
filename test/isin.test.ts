import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIsin, isinCheckDigit } from "../src/lib/isin";

/**
 * The ISIN is the only thing the CSD uses to know which security is meant,
 * so a wrong one is a pledge against somebody else's shares rather than an
 * error. Format alone would accept every such mistake; the check digit is
 * what catches it.
 */

/* Published ISINs, used as fixtures because a check-digit implementation
   that is subtly wrong still returns a digit and still passes made-up
   examples that were generated with the same mistake. */
const REAL = [
  "US0378331005", // Apple
  "GB0002634946", // BAE Systems
  "TZ1996100305", // CRDB Bank
  "TZ1996100222", // NMB
  "TZ1996102715", // Vodacom Tanzania
  "TZ1996100016", // TBL
  "KE0000000216", // EABL
];

test("real ISINs pass", () => {
  for (const isin of REAL) {
    const r = checkIsin(isin);
    assert.ok(r.ok, `${isin} was rejected: ${r.ok ? "" : r.reason}`);
  }
});

test("the check digit is recomputed, not just read back", () => {
  for (const isin of REAL) {
    assert.equal(isinCheckDigit(isin.slice(0, 11)), isin.charCodeAt(11) - 48, isin);
  }
});

test("one wrong digit is caught", () => {
  /* The failure that matters: TZ1996100305 is CRDB and TZ1996100205 is not
     a security we meant. */
  const r = checkIsin("TZ1996100205");
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /check digit/);
});

test("a transposition is caught", () => {
  /* Two adjacent digits swapped — the classic typing error, and the one a
     format check cannot see. */
  const r = checkIsin("TZ1996100350");
  assert.equal(r.ok, false);
});

test("an ISIN-shaped string with no meaning is caught", () => {
  assert.equal(checkIsin("TZ0000000001").ok, false, "the guide's own placeholder");
  assert.equal(checkIsin("XX1234567890").ok, false);
});

test("the wrong shape is reported as the wrong shape", () => {
  for (const bad of ["", "   ", "TZ199610030", "TZ19961003055", "1Z1996100305", "TZ199610030X"]) {
    const r = checkIsin(bad);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
    /* A shape complaint, not a check-digit one: the two need different
       responses, and the format message legitimately mentions a check digit
       while describing the shape. */
    assert.ok(!/fails its own check digit/.test((r as { reason: string }).reason), bad);
  }
});

test("casing and stray spaces are forgiven, since it comes from a table", () => {
  assert.deepEqual(checkIsin(" tz1996100305 "), { ok: true, isin: "TZ1996100305" });
});

test("every seeded DSE ISIN passes its own check digit", async () => {
  /* How the transcription from DSE's table was verified, and what keeps it
     verified: a single wrong character in any of these would fail here
     rather than reaching a pledge instruction. */
  const { DSE_ISINS } = await import("../src/lib/dseIsins");
  const bad = Object.entries(DSE_ISINS)
    .map(([symbol, isin]) => [symbol, checkIsin(isin)] as const)
    .filter(([, r]) => !r.ok)
    .map(([symbol, r]) => `${symbol}: ${(r as { reason: string }).reason}`);
  assert.deepEqual(bad, []);
  assert.ok(Object.keys(DSE_ISINS).length >= 25, "the board, not a sample");
});
