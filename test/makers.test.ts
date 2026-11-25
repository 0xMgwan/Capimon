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
  ({ id: name.toLowerCase(), kind, name, capacity, reason: capacity > 0 ? null : "none",
     settlement: { address: null, approved: null, canSettle: false, reason: "test" } });

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

// ── the ledger entries a routed trade writes ─────────────────────────────

import { tradeLegs, legsBalance } from "../src/lib/makers";

const near = (v: number, want: number, what: string) =>
  assert.ok(Math.abs(v - want) < 1e-9, `${what}: ${v} should be ${want}`);

const balanced = (legs: ReturnType<typeof tradeLegs>, symbol = "CRDB") => {
  const b = legsBalance(legs);
  near(b.get("TZS") ?? 0, 0, "shillings");
  near(b.get(symbol) ?? 0, 0, "shares");
};

test("a treasury-only buy writes the legs the order path always wrote", () => {
  const legs = tradeLegs({
    orderId: "o1", side: "buy", symbol: "CRDB",
    qty: 4, tzs: 11_000, netTzs: 10_725, fee: 275,
    fills: [{ id: "treasury", kind: "treasury", amount: 4 }],
  });
  balanced(legs);
  assert.ok(legs.some((l) => l.party === "house" && "account" in l && l.account === "inventory"));
  assert.ok(!legs.some((l) => l.party === "provider"));
});

test("a provider's fill credits the provider, not the float", () => {
  /* They gave up the shares, so the proceeds are theirs. Writing these
     against the house would have the float pay for inventory it never held
     and credit itself for a sale it never made. */
  const legs = tradeLegs({
    orderId: "o2", side: "buy", symbol: "CRDB",
    qty: 4, tzs: 11_000, netTzs: 10_725, fee: 275,
    fills: [{ id: "fimco", kind: "provider", userId: "u-fimco", amount: 4 }],
  });
  balanced(legs);
  const cash = legs.find((l) => l.party === "provider" && l.asset === "TZS");
  assert.ok(cash && cash.amount === 10_725);
  assert.ok(!legs.some((l) => l.party === "house" && "account" in l && l.account === "float"));
});

test("a split fill balances and pays each maker their share", () => {
  const legs = tradeLegs({
    orderId: "o3", side: "buy", symbol: "CRDB",
    qty: 10, tzs: 27_500, netTzs: 26_812.5, fee: 687.5,
    fills: [
      { id: "fimco", kind: "provider", userId: "u-fimco", amount: 6 },
      { id: "treasury", kind: "treasury", amount: 4 },
    ],
  });
  balanced(legs);
  const fimco = legs.find((l) => l.party === "provider" && l.asset === "TZS");
  near(fimco!.amount, 26_812.5 * 0.6, "FIMCO's 60% share");
});

test("a three-way split still balances exactly", () => {
  /* Thirds do not sum back to the whole in floating point. An unbalanced
     ledger is refused by assertBalanced, so the trade would fail after the
     customer had already been quoted. */
  const legs = tradeLegs({
    orderId: "o4", side: "buy", symbol: "CRDB",
    qty: 1, tzs: 1_000, netTzs: 975, fee: 25,
    fills: [
      { id: "a", kind: "provider", userId: "ua", amount: 1 / 3 },
      { id: "b", kind: "provider", userId: "ub", amount: 1 / 3 },
      { id: "c", kind: "provider", userId: "uc", amount: 1 / 3 },
    ],
  });
  balanced(legs);
});

test("a sell reverses every leg", () => {
  /* On a sell the quote's netTzs is the gross — what leaves the float — and
     tzs is what the customer is left with after the fee. The two are the
     other way round from a buy, which is exactly the sort of thing a legs
     builder gets backwards, so the balance assertion below is the check. */
  const legs = tradeLegs({
    orderId: "o5", side: "sell", symbol: "CRDB",
    qty: 4, tzs: 10_725, netTzs: 11_000, fee: 275,
    fills: [{ id: "treasury", kind: "treasury", amount: 4 }],
  });
  balanced(legs);
  const shares = legs.find((l) => l.party === "customer" && l.asset === "CRDB");
  assert.ok(shares!.amount < 0, "the customer gives up shares");
  const cash = legs.find((l) => l.party === "customer" && l.asset === "TZS");
  assert.ok(cash!.amount > 0, "and is paid");
});

test("the fee is taken once and never split across makers", () => {
  /* A maker is paid for what they sold. The platform fee is CAPX's
     relationship with the customer and has nothing to do with who had the
     inventory. */
  const legs = tradeLegs({
    orderId: "o6", side: "buy", symbol: "CRDB",
    qty: 10, tzs: 27_500, netTzs: 26_812.5, fee: 687.5,
    fills: [
      { id: "a", kind: "provider", userId: "ua", amount: 5 },
      { id: "b", kind: "provider", userId: "ub", amount: 5 },
    ],
  });
  const fees = legs.filter((l) => l.party === "house" && "account" in l && l.account === "fee");
  assert.equal(fees.length, 1);
  assert.equal(fees[0].amount, 687.5);
});

test("every leg carries a distinct reference", () => {
  /* The ledger's ref index is unique, so two makers sharing one would make
     the second fill silently vanish. */
  const legs = tradeLegs({
    orderId: "o7", side: "buy", symbol: "CRDB",
    qty: 9, tzs: 24_750, netTzs: 24_131.25, fee: 618.75,
    fills: [
      { id: "a", kind: "provider", userId: "ua", amount: 3 },
      { id: "b", kind: "provider", userId: "ub", amount: 3 },
      { id: "treasury", kind: "treasury", amount: 3 },
    ],
  });
  const refs = legs.map((l) => l.ref);
  assert.equal(new Set(refs).size, refs.length, refs.join(" "));
  balanced(legs);
});

test("a provider selling into a customer buy balances both ways", () => {
  /* The whole point of routing: a provider's inventory returns to the pool
     at the moment somebody wants it, rather than on a cron. Both the buy and
     the matching sell must balance, or releaseInventory and this path would
     disagree about the same position. */
  for (const side of ["buy", "sell"] as const) {
    const gross = 27_500;
    const fee = 687.5;
    const legs = tradeLegs({
      orderId: `o8-${side}`, side, symbol: "CRDB", qty: 10,
      tzs: side === "buy" ? gross + fee : gross - fee,
      netTzs: gross, fee,
      fills: [{ id: "fimco", kind: "provider", userId: "u-fimco", amount: 10 }],
    });
    balanced(legs);
  }
});
