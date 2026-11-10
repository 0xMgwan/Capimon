import { test } from "node:test";
import assert from "node:assert/strict";
import { sharesToAssets, suppliableSurplus, withdrawable } from "../src/lib/aaveYield";

/**
 * The parts of the yield position that decide things, without a chain.
 *
 * All three guard money. A share conversion that rounds badly misreports what
 * backs the book; a surplus that ignores the buffer lends out dollars the next
 * order needs; a withdrawal that trusts the amount it asked for lets a caller
 * spend liquidity the hub does not have.
 */

/* Live values read from reserve 7 while writing this, so the arithmetic is
   pinned against something real rather than against a round number. */
const TOTAL_ASSETS = 7_881_247_627_700n;   // 7,881,247.6277 USDC
const TOTAL_SHARES = 7_864_617_733_178n;   // share price 1.002114520

test("shares convert at the reserve's live rate, not one-to-one", () => {
  const oneShare = 1_000_000n;
  const worth = sharesToAssets(oneShare, TOTAL_ASSETS, TOTAL_SHARES);
  assert.ok(worth > 1.0021 && worth < 1.0022, `expected ~1.00211, got ${worth}`);
});

test("interest shows up as the same shares being worth more", () => {
  const shares = 1_000_000_000n;
  const before = sharesToAssets(shares, TOTAL_ASSETS, TOTAL_SHARES);
  // The pool earns 1%: same shares, more assets behind them.
  const after = sharesToAssets(shares, (TOTAL_ASSETS * 101n) / 100n, TOTAL_SHARES);
  assert.ok(after > before);
  assert.ok(Math.abs(after / before - 1.01) < 1e-9, `${after / before}`);
});

test("a large position does not lose precision to a double", () => {
  // A uint120 share count times total assets overflows a double by a wide
  // margin; doing it in bigint first is the whole point.
  const big = 10n ** 18n;
  const got = sharesToAssets(big, TOTAL_ASSETS, TOTAL_SHARES);
  const want = (Number(TOTAL_ASSETS) / Number(TOTAL_SHARES)) * 1e12;
  assert.ok(Math.abs(got - want) / want < 1e-9, `${got} vs ${want}`);
});

test("nothing held, nothing supplied, no divide by zero", () => {
  assert.equal(sharesToAssets(0n, TOTAL_ASSETS, TOTAL_SHARES), 0);
  assert.equal(sharesToAssets(100n, 0n, 0n), 0, "an empty reserve must not divide by zero");
});

test("the buffer stays on-chain", () => {
  assert.equal(suppliableSurplus(100, 25), 75);
  assert.equal(suppliableSurplus(25, 25), 0, "exactly the buffer leaves nothing to supply");
  assert.equal(suppliableSurplus(10, 25), 0, "below the buffer must never go negative");
});

test("dust is left alone rather than supplied at a loss", () => {
  assert.equal(suppliableSurplus(27, 25), 0, "two dollars is not worth two transactions");
  assert.equal(suppliableSurplus(30, 25), 5, "at the minimum it goes");
});

test("a withdrawal is bounded by the position and by the hub's liquidity", () => {
  assert.equal(withdrawable(100, 500, 500), 100, "ordinary case: what was asked");
  assert.equal(withdrawable(900, 500, 500), 500, "never more than is held");
  assert.equal(withdrawable(400, 500, 120), 120, "never more than the hub can pay");
  assert.equal(withdrawable(0, 500, 500), 0);
  assert.equal(withdrawable(-5, 500, 500), 0, "a negative ask is not a deposit");
  assert.equal(withdrawable(100, 0, 500), 0, "nothing supplied, nothing to take");
});
