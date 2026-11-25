import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, totalCapacity, type MakerCapacity } from "../src/lib/makers";

/**
 * Who fills a customer's order once CAPX is one maker among several.
 *
 * The reading is tested elsewhere; the rule is here. What has to hold: the
 * order goes to whoever has most posted, the treasury gets no privilege for
 * being the treasury, an order larger than the book reports what is missing
 * rather than silently filling short, and two identical reads allocate
 * identically.
 */

const m = (name: string, capacity: number, kind: "treasury" | "provider" = "provider"): MakerCapacity =>
  ({ id: name.toLowerCase(), kind, name, capacity, reason: capacity > 0 ? null : "none" });

const BOOK = [
  m("CAPX treasury", 800, "treasury"),
  m("FIMCO", 2_000),
  m("KCB", 1_200),
];

test("one maker covers an order that fits", () => {
  const a = allocate(BOOK, 500);
  assert.equal(a.fills.length, 1, "one fill, one settlement, one counterparty");
  assert.deepEqual(a.fills[0], { id: "fimco", kind: "provider", name: "FIMCO", amount: 500 });
  assert.equal(a.unfilled, 0);
});

test("the largest goes first, then the next largest", () => {
  const a = allocate(BOOK, 2_500);
  assert.deepEqual(a.fills.map((f) => [f.name, f.amount]), [["FIMCO", 2_000], ["KCB", 500]]);
  assert.equal(a.unfilled, 0);
});

test("the treasury has no privilege for being the treasury", () => {
  /* The whole point of the router: CAPX fills when it has the most posted,
     not because the code was written around its balance. */
  const a = allocate(BOOK, 100);
  assert.equal(a.fills[0].name, "FIMCO");
  assert.notEqual(a.fills[0].kind, "treasury");
});

test("the treasury fills when it is the largest", () => {
  const a = allocate([m("CAPX treasury", 5_000, "treasury"), m("FIMCO", 100)], 400);
  assert.deepEqual(a.fills.map((f) => f.name), ["CAPX treasury"]);
});

test("an order beyond the whole book reports what is missing", () => {
  /* Never a quiet short fill: the caller has to decide what to do about the
     remainder, and a silent one would settle a customer at a size they did
     not ask for. */
  const a = allocate(BOOK, 10_000);
  assert.equal(a.fills.reduce((t, f) => t + f.amount, 0), 4_000);
  assert.equal(a.unfilled, 6_000);
  assert.equal(totalCapacity(BOOK), 4_000);
});

test("makers with nothing to offer are skipped, not filled for zero", () => {
  const a = allocate([m("FIMCO", 0), m("KCB", 300), m("Paused", 0)], 200);
  assert.deepEqual(a.fills.map((f) => f.name), ["KCB"]);
});

test("an empty book fills nothing and says so", () => {
  const a = allocate([], 500);
  assert.deepEqual(a.fills, []);
  assert.equal(a.unfilled, 500);
});

test("wanting nothing allocates nothing", () => {
  assert.deepEqual(allocate(BOOK, 0), { fills: [], unfilled: 0 });
  assert.deepEqual(allocate(BOOK, -5), { fills: [], unfilled: 0 });
});

test("ties break the same way every time", () => {
  /* Two reads of the same book must allocate identically, or a fill cannot
     be reconciled against the decision that produced it. */
  const tied = [m("Zanzibar Cap", 1_000), m("Arusha Bank", 1_000), m("KCB", 1_000)];
  const first = allocate(tied, 1_500);
  const again = allocate([...tied].reverse(), 1_500);
  assert.deepEqual(first.fills, again.fills);
  assert.equal(first.fills[0].name, "Arusha Bank");
});

test("a rounding remainder is not given a counterparty", () => {
  /* Fractional claims mean an allocation can leave a sliver. Recording a
     fill for it would create a settlement for a quantity the ledger cannot
     represent. */
  const a = allocate([m("FIMCO", 1_000), m("KCB", 1e-12)], 1_000 + 1e-12);
  assert.deepEqual(a.fills.map((f) => f.name), ["FIMCO"]);
  assert.ok(a.unfilled < 1e-9);
});

test("largest-first tends toward the pro-rata split over many orders", () => {
  /* The property that made this acceptable instead of splitting every order:
     flow moves to whoever has most left, so a run of orders distributes
     roughly in proportion to what each maker posted. */
  const posted = { FIMCO: 2_000, KCB: 1_200, Treasury: 800 };
  const left = { ...posted };
  const got: Record<string, number> = { FIMCO: 0, KCB: 0, Treasury: 0 };

  for (let i = 0; i < 40; i++) {
    const book = Object.entries(left).map(([n, c]) => m(n, c));
    for (const f of allocate(book, 100).fills) {
      got[f.name] += f.amount;
      left[f.name as keyof typeof left] -= f.amount;
    }
  }

  const total = Object.values(got).reduce((a, b) => a + b, 0);
  assert.equal(total, 4_000, "the whole book is consumed");
  for (const k of Object.keys(posted) as (keyof typeof posted)[]) {
    const share = got[k] / total;
    const target = posted[k] / 4_000;
    assert.ok(Math.abs(share - target) < 0.02,
      `${k} took ${(share * 100).toFixed(1)}% against ${(target * 100).toFixed(1)}% posted`);
  }
});
