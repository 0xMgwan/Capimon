import { test } from "node:test";
import assert from "node:assert/strict";
import { instantAllowed, INSTANT_CAP, instantExposureCap } from "../src/lib/instantCredit";

/**
 * The decision to credit before a block is safe, tested without a chain.
 *
 * This is the one place in the deposit path where CAPX deliberately gives up
 * a safety property, so the arithmetic that bounds it is worth pinning
 * exactly. Every case below is a way the bound could be wrong in the
 * direction that costs money.
 */

const usdcCap = INSTANT_CAP.USDC;
const usdcExposure = instantExposureCap("USDC");

test("a small deposit goes early", () => {
  const v = instantAllowed({ token: "USDC", amount: 1, outstanding: 0 });
  assert.equal(v.instant, true);
});

test("the per-deposit ceiling is inclusive at the top and refuses above it", () => {
  assert.equal(instantAllowed({ token: "USDC", amount: usdcCap, outstanding: 0 }).instant, true);
  const over = instantAllowed({ token: "USDC", amount: usdcCap + 0.01, outstanding: 0 });
  assert.equal(over.instant, false);
  assert.match((over as { reason: string }).reason, /ceiling/);
});

test("ten small deposits are not a small deposit", () => {
  // Each one is under the per-deposit cap; together they are not.
  const v = instantAllowed({ token: "USDC", amount: 1, outstanding: usdcExposure });
  assert.equal(v.instant, false, "the exposure ceiling must bind even when the deposit is tiny");
  assert.match((v as { reason: string }).reason, /unsettled/);
});

test("the exposure ceiling counts the deposit being decided, not just the ones before it", () => {
  const justUnder = usdcExposure - 1;
  assert.equal(instantAllowed({ token: "USDC", amount: 1, outstanding: justUnder }).instant, true);
  assert.equal(instantAllowed({ token: "USDC", amount: 2, outstanding: justUnder }).instant, false,
    "outstanding + amount is the figure that must fit, not outstanding alone");
});

test("an unreadable exposure refuses rather than waving through", () => {
  // earlyOutstanding returns Infinity when it cannot be measured.
  const v = instantAllowed({ token: "USDC", amount: 1, outstanding: Infinity });
  assert.equal(v.instant, false, "a ceiling that cannot be measured must not be assumed empty");
});

test("a zero or negative amount is never credited early", () => {
  assert.equal(instantAllowed({ token: "USDC", amount: 0, outstanding: 0 }).instant, false);
  assert.equal(instantAllowed({ token: "USDC", amount: -5, outstanding: 0 }).instant, false);
});

test("the two tokens are bounded separately, in their own units", () => {
  // 60,000 TZS is a sane early credit; 60,000 USDC very much is not.
  assert.equal(instantAllowed({ token: "NTZS", amount: 60_000, outstanding: 0 }).instant,
    INSTANT_CAP.NTZS >= 60_000);
  assert.equal(instantAllowed({ token: "USDC", amount: 60_000, outstanding: 0 }).instant, false,
    "a TZS-sized number must never pass as a USDC amount");
});

test("every refusal explains which ceiling stopped it", () => {
  for (const v of [
    instantAllowed({ token: "USDC", amount: usdcCap * 2, outstanding: 0 }),
    instantAllowed({ token: "USDC", amount: 1, outstanding: usdcExposure }),
    instantAllowed({ token: "USDC", amount: 0, outstanding: 0 }),
  ]) {
    assert.equal(v.instant, false);
    assert.ok((v as { reason: string }).reason.length > 0, "a silent refusal is unactionable");
  }
});

test("the exposure ceiling is a multiple of the per-deposit one, never below it", () => {
  for (const token of ["USDC", "NTZS"] as const) {
    assert.ok(instantExposureCap(token) >= INSTANT_CAP[token],
      `${token}: an exposure ceiling under the per-deposit ceiling would make the second dead`);
  }
});
