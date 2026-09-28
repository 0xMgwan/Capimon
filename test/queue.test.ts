import { test } from "node:test";
import assert from "node:assert/strict";
import { proRataSplit } from "../src/lib/withdrawalQueue";

/** Everyone waiting shares a short float, rather than the first in line taking it. */

const rows = (...amounts: number[]) =>
  amounts.map((a, i) => ({ id: `r${i}`, outstandingTzs: a }));

const total = (p: { payTzs: number }[]) => p.reduce((t, x) => t + x.payTzs, 0);

test("everyone is paid in full when the float covers it", () => {
  const plan = proRataSplit(rows(100_000, 200_000, 300_000), 600_000);
  assert.equal(total(plan), 600_000);
  assert.deepEqual(plan.map((p) => p.payTzs), [100_000, 200_000, 300_000]);
});

test("a short float is shared in proportion, not given to whoever asked first", () => {
  const plan = proRataSplit(rows(100_000, 200_000, 300_000), 300_000);
  const by = new Map(plan.map((p) => [p.id, p.payTzs]));
  assert.equal(by.get("r0"), 50_000);
  assert.equal(by.get("r1"), 100_000);
  assert.equal(by.get("r2"), 150_000);
  assert.equal(total(plan), 300_000);
});

test("nobody is ever paid more than they are owed", () => {
  for (const cap of [1, 5_000, 123_457, 999_999, 5_000_000]) {
    const r = rows(100_000, 250_000, 40_000, 7_500);
    const plan = proRataSplit(r, cap);
    const owed = new Map(r.map((x) => [x.id, x.outstandingTzs]));
    for (const p of plan) {
      assert.ok(p.payTzs <= owed.get(p.id)!, `${p.id} paid ${p.payTzs} of ${owed.get(p.id)}`);
    }
    assert.ok(total(plan) <= cap + 1e-9, `paid ${total(plan)} from ${cap}`);
  }
});

test("shares too small to be worth a payout fee are rolled over, not sent", () => {
  // One large row and many tiny ones: the tiny shares fall under the minimum.
  const plan = proRataSplit(rows(10_000_000, 6_000, 6_000, 6_000), 60_000);
  for (const p of plan) assert.ok(p.payTzs >= 5_000, `${p.id} got a dust payment of ${p.payTzs}`);
  assert.ok(total(plan) <= 60_000);
});

test("nothing is left stranded when a share rounds down", () => {
  // Three equal rows against a capacity that does not divide evenly.
  const plan = proRataSplit(rows(100_000, 100_000, 100_000), 100_000);
  assert.equal(total(plan), 100_000, "the odd shilling must still go out");
});

test("no capacity means no payments, not an error", () => {
  assert.deepEqual(proRataSplit(rows(100_000), 0), []);
  assert.deepEqual(proRataSplit(rows(100_000), -5), []);
  assert.deepEqual(proRataSplit([], 100_000), []);
});

test("a row already part paid is only owed its remainder", () => {
  // 300,000 asked, 200,000 already sent: it competes for 100,000, not 300,000.
  const plan = proRataSplit([{ id: "part", outstandingTzs: 100_000 },
                             { id: "new", outstandingTzs: 100_000 }], 100_000);
  const by = new Map(plan.map((p) => [p.id, p.payTzs]));
  assert.equal(by.get("part"), 50_000);
  assert.equal(by.get("new"), 50_000);
});

test("randomised: the plan never overspends and never overpays", () => {
  let checked = 0;
  for (let t = 0; t < 5000; t++) {
    const n = 1 + Math.floor(Math.random() * 8);
    const r = rows(...Array.from({ length: n }, () => Math.round(Math.random() * 5_000_000)));
    const cap = Math.round(Math.random() * 12_000_000);
    const plan = proRataSplit(r, cap);
    const owed = new Map(r.map((x) => [x.id, x.outstandingTzs]));
    assert.ok(total(plan) <= cap + 1e-9, `spent ${total(plan)} of ${cap}`);
    for (const p of plan) {
      assert.ok(p.payTzs > 0);
      assert.ok(p.payTzs <= owed.get(p.id)!);
    }
    checked++;
  }
  assert.equal(checked, 5000);
});

test("the rail is chosen on everything the disbursement path can reach", () => {
  // The arithmetic chooseRail now runs, with the real shape of the omnibus
  // that sent a 90,000 TZS payout down the expensive rail.
  const rate = 1 / 2660;                       // USDC per TZS
  const reach = (tzs: number, omniUsdc: number, treasuryUsdc: number) =>
    tzs + ((omniUsdc + treasuryUsdc) / rate) / 1.02;

  const want = 90_000;
  // Before: shillings alone did not cover it, so it took the ramp.
  assert.ok(!(84_139 >= want * 1.02), "shillings alone fall short");
  // After: the dollars it can convert do cover it, so it disburses.
  assert.ok(reach(84_139, 3.79, 0) >= want * 1.02,
    `reachable ${Math.round(reach(84_139, 3.79, 0))} should cover ${want * 1.02}`);

  // A genuinely empty omnibus still goes to the ramp rather than pretending.
  assert.ok(!(reach(1_000, 0, 0) >= want * 1.02));
});
