import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeCustodyAccount, cdsAccount, pledgeQuantityFor, DseCustodyError,
} from "../src/lib/dseCustody";

/**
 * The parts that can be wrong without the network being involved.
 *
 * The two account numbers the API's field names get backwards, and the
 * rounding direction on a fractional book. Both are mistakes that type-check,
 * run, and are only discovered by their consequences.
 */

// ── the two accounts ─────────────────────────────────────────────────────

test("a safe-custody account is accepted and normalised", () => {
  assert.equal(safeCustodyAccount("b21/c"), "B21/C");
  assert.equal(safeCustodyAccount("  B7/A  "), "B7/A");
});

test("an investor CDS account is refused where the broker's belongs", () => {
  /* The mistake this type exists for: the API calls the broker's account
     `csdAccount` and the investor's `brokerCode`, so handing them over the
     wrong way round reads perfectly well. */
  assert.throws(() => safeCustodyAccount("0123456789"), (e: unknown) => {
    assert.ok(e instanceof DseCustodyError);
    assert.equal(e.code, "bad_account");
    return true;
  });
});

test("a broker account is refused where the investor's belongs", () => {
  assert.throws(() => cdsAccount("B21/C"), (e: unknown) => {
    assert.ok(e instanceof DseCustodyError);
    assert.match(e.message, /swapped relative to the API's field names/);
    return true;
  });
});

test("a CDS account is accepted without a guessed format", () => {
  /* The numbering is not documented to us, so anything that is not the one
     pattern we know belongs elsewhere goes through. Refusing on a guess
     would reject real accounts. */
  assert.equal(cdsAccount("0123456789"), "0123456789");
  assert.equal(cdsAccount("cds-99/x"), "CDS-99/X");
});

test("an empty CDS account is refused", () => {
  assert.throws(() => cdsAccount("   "), /required/);
});

// ── the rounding direction ───────────────────────────────────────────────

test("a fractional book rounds the pledge up, never down", () => {
  /* 10,000 TZS of a 2,750 TZS share is 3.63 shares. Pledging 3 leaves the
     book short; pledging 4 leaves CAPX holding the remainder, which is the
     side to be wrong on. */
  assert.equal(pledgeQuantityFor(10_000 / 2_750), 4);
  assert.equal(pledgeQuantityFor(0.0001), 1);
  assert.equal(pledgeQuantityFor(100.5), 101);
});

test("a whole quantity is not rounded up to the next share", () => {
  /* Without the epsilon, a sum of fractional claims that lands on a whole
     number by arithmetic rather than exactly — 0.1 + 0.2 + ... — would pledge
     one share more every time it was recalculated. */
  assert.equal(pledgeQuantityFor(4), 4);
  assert.equal(pledgeQuantityFor(0.1 + 0.2 + 0.7), 1);
  assert.equal(pledgeQuantityFor(3 * (1 / 3)), 1);
});

test("holding nothing pledges nothing", () => {
  assert.equal(pledgeQuantityFor(0), 0);
  assert.equal(pledgeQuantityFor(-5), 0);
});
