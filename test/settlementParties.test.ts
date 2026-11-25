import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { normaliseAddress } from "../src/lib/settlementParties";

/**
 * The address a maker settles to.
 *
 * Everything else about a maker can be wrong and be noticed. A wrong
 * settlement address is noticed when a token has already been sent to it, so
 * the rules about what is accepted and how it is stored are tested rather
 * than trusted.
 */

/* A real checksummed address, and the same one in other casings. */
const MIXED = "0x7ff9A98B0769647213e5599Ddc805317b1b402Fa";
const LOWER = MIXED.toLowerCase();
const UPPER = "0x7FF9A98B0769647213E5599DDC805317B1B402FA";

test("a correctly checksummed address is accepted", () => {
  assert.equal(normaliseAddress(MIXED), LOWER);
});

test("an address written without a checksum is accepted", () => {
  /* Plenty of tools print all-lowercase or all-uppercase. Refusing those
     would reject addresses that are perfectly correct. */
  assert.equal(normaliseAddress(LOWER), LOWER);
  assert.equal(normaliseAddress(UPPER), LOWER);
});

test("a mistyped digit in a checksummed address is caught", () => {
  /* The protection worth having. The checksum is computed over the hex
     digits, so changing one produces a different capitalisation pattern and
     the comparison fails — an address pasted with a checksum is verified
     against the one its owner published. */
  const typo = MIXED.replace("0x7ff9A98B", "0x7ff8A98B");
  assert.notEqual(typo.toLowerCase(), LOWER, "a different address, not a re-casing");
  assert.equal(normaliseAddress(typo), null);
});

test("a re-cased checksummed address is refused too", () => {
  /* Flipping case alone does not change which address it is, so this is
     stricter than it needs to be and deliberately so: a checksummed address
     that does not match its own checksum has been edited by something, and
     the cheap response is to decline it rather than work out what. */
  const recased = MIXED.replace("0x7ff9A98B", "0x7ff9a98B");
  assert.equal(recased.toLowerCase(), LOWER);
  assert.equal(normaliseAddress(recased), null);
});

test("getAddress alone would have accepted both", () => {
  /* Guards the reason the comparison exists. viem's getAddress recomputes
     the capitalisation instead of validating it, so a try/catch around it
     rejects nothing — if that ever changes, this test says so rather than
     the check quietly becoming redundant. */
  assert.equal(getAddress(MIXED.replace("0x7ff9A98B", "0x7ff9a98B")), MIXED);
});

test("everything that is not an address is refused", () => {
  for (const bad of [
    "", "   ", "0x", "not-an-address",
    LOWER.slice(0, -1),            // too short
    `${LOWER}00`,                  // too long
    LOWER.replace("0x", ""),       // no prefix
    `${LOWER} `.replace("a", "g"), // not hex
  ]) {
    assert.equal(normaliseAddress(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("surrounding whitespace is forgiven, since it comes from pasting", () => {
  assert.equal(normaliseAddress(`  ${MIXED}\n`), LOWER);
});

test("it always stores one casing", () => {
  /* Stored lowercase so a comparison against a checksummed copy of the same
     address cannot fail for some addresses and pass for others. */
  const all = [MIXED, LOWER, UPPER].map(normaliseAddress);
  assert.equal(new Set(all).size, 1);
  assert.equal(all[0], all[0]!.toLowerCase());
});
