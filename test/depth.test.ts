import { test } from "node:test";
import assert from "node:assert/strict";
import { depthFrom, IMPACT_LIMIT_PCT } from "../src/lib/depth";

/**
 * Picking "how much can somebody buy" out of a ladder of real quotes.
 *
 * Measured off NVDAc while writing this, so the shape is the real one: a
 * quarter of a million dollars fills inside half a percent, and a million
 * moves the price eleven.
 */
const NVDA = [
  { usd: 1_000, shares: 5.8076, impactPct: 0.0 },
  { usd: 10_000, shares: 58.0871, impactPct: -0.02 },
  { usd: 100_000, shares: 579.0662, impactPct: 0.29 },
  { usd: 250_000, shares: 1435.414, impactPct: 1.15 },
  { usd: 500_000, shares: 2799.8946, impactPct: 3.71 },
];

test("available is the largest order that fills inside the limit", () => {
  const d = depthFrom(172.18, NVDA)!;
  assert.equal(d.maxOrderUsd, 250_000, "500k costs 3.71%, over the 2% limit");
  assert.equal(d.availableShares, 1435.414);
  assert.equal(d.impactLimitPct, IMPACT_LIMIT_PCT);
});

test("it is neither what CAPX holds nor what exists onchain", () => {
  const d = depthFrom(172.18, NVDA)!;
  // The treasury held 0.106 and onchain supply was 41,770. Both were offered
  // as "available" at some point and both were wrong by orders of magnitude.
  assert.ok(d.availableShares > 1_000, "must not collapse to the treasury's balance");
  assert.ok(d.availableShares < 41_770, "must not claim supply nobody has offered to sell");
});

test("impact is not assumed to be monotonic noise — the walk stops at the first breach", () => {
  const noisy = [
    { usd: 1_000, shares: 5.8, impactPct: 0.0 },
    { usd: 10_000, shares: 58, impactPct: 5 },     // breaches
    { usd: 100_000, shares: 580, impactPct: 0.1 }, // cheap again: noise, not depth
  ];
  const d = depthFrom(172.18, noisy)!;
  assert.equal(d.maxOrderUsd, 1_000,
    "a cheap quote past an expensive one must not be read as depth");
});

test("a market too thin even at the smallest probe reports zero, with the ladder", () => {
  const thin = [{ usd: 1_000, shares: 4, impactPct: 40 }];
  const d = depthFrom(172.18, thin)!;
  assert.equal(d.availableShares, 0);
  assert.equal(d.maxOrderUsd, 0);
  assert.equal(d.ladder.length, 1, "the quote still comes back — thin is not the same as empty");
});

test("deeper than we probed is flagged rather than presented as the ceiling", () => {
  const deep = NVDA.map((r) => ({ ...r, impactPct: 0.1 }));
  const d = depthFrom(172.18, deep)!;
  assert.equal(d.maxOrderUsd, 500_000);
  assert.equal(d.deeperThanProbed, true,
    "every rung filled cheaply, so the real depth is past the last one");
});

test("rungs that failed to quote are absent, not zero", () => {
  // The aggregator rate-limits; a refused request must not read as no liquidity.
  const gappy = [NVDA[0], NVDA[3]];
  const d = depthFrom(172.18, gappy)!;
  assert.equal(d.maxOrderUsd, 250_000, "a missing middle rung must not cap the answer");
});

test("an unusable reference price yields nothing rather than a divide by zero", () => {
  assert.equal(depthFrom(0, NVDA), null);
  assert.equal(depthFrom(172.18, []), null);
});

test("the ladder comes back sorted however it arrived", () => {
  const d = depthFrom(172.18, [...NVDA].reverse())!;
  assert.deepEqual(d.ladder.map((r) => r.usd), [1_000, 10_000, 100_000, 250_000, 500_000]);
});
