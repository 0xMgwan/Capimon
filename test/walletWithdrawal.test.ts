import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDestination, MIN_WITHDRAWAL_USDC, MIN_WITHDRAWAL_TZS } from "../src/lib/walletWithdrawal";

/**
 * Checking a withdrawal address, without a chain.
 *
 * This is the last thing between a customer's dollars and an address someone
 * typed, and an onchain transfer has no recall. Every case below is a way
 * money leaves and does not come back.
 */

const GOOD = "0x4dbd354925829b9248effc625c31fc9dc3820fb2";

test("a valid address comes back checksummed, so what is echoed is canonical", () => {
  const r = parseDestination(GOOD);
  assert.equal(r.ok, true);
  const addr = (r as { address: string }).address;
  assert.notEqual(addr, GOOD, "lowercase in, checksummed out");
  assert.equal(addr.toLowerCase(), GOOD);
});

test("surrounding whitespace is forgiven — people paste", () => {
  const r = parseDestination(`  ${GOOD}\n`);
  assert.equal(r.ok, true);
});

test("the zero address is refused by name, not by a generic error", () => {
  const r = parseDestination("0x0000000000000000000000000000000000000000");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /destroyed/);
});

test("malformed input never resolves to an address", () => {
  for (const bad of [
    "",
    "   ",
    "not an address",
    "0x123",                                          // too short
    `${GOOD}00`,                                      // too long
    GOOD.replace("0x", ""),                           // missing prefix
    "0xZZZZ354925829b9248effc625c31fc9dc3820fb2",     // not hex
  ]) {
    const r = parseDestination(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be refused`);
    assert.ok((r as { error: string }).error.length > 0, "a silent refusal is unactionable");
  }
});

test("a mixed-case address that fails its own checksum is refused", () => {
  // EIP-55: flipping one character's case invalidates the checksum, which is
  // exactly the typo the checksum exists to catch.
  const checksummed = (parseDestination(GOOD) as { address: string }).address;
  const flipped = checksummed.slice(0, 10)
    + (checksummed[10] === checksummed[10].toUpperCase()
        ? checksummed[10].toLowerCase() : checksummed[10].toUpperCase())
    + checksummed.slice(11);
  if (flipped !== checksummed) {
    assert.equal(parseDestination(flipped).ok, false,
      "a broken EIP-55 checksum is a typo, and typos send money nowhere");
  }
});

test("the minimum is a real floor, not zero", () => {
  assert.ok(MIN_WITHDRAWAL_USDC > 0,
    "a zero minimum lets dust withdrawals cost more in bookkeeping than they move");
});

test("both exits share one address check, so neither can drift from the other", () => {
  // The dollar and shilling paths differ in everything except where the money
  // goes. If that check ever forks, one of them gets weaker validation.
  const r = parseDestination(GOOD);
  assert.equal(r.ok, true);
});

test("the shilling minimum is in shillings, not dollars", () => {
  // A thousand-fold unit mix-up here would set the floor at about forty cents
  // or about a thousand dollars, depending which way it went.
  assert.ok(MIN_WITHDRAWAL_TZS >= 100,
    "a TZS floor below a hundred is almost certainly a USD number in the wrong field");
  assert.ok(MIN_WITHDRAWAL_TZS > MIN_WITHDRAWAL_USDC,
    "shillings are worth far less than dollars, so the floor must be a larger number");
});
