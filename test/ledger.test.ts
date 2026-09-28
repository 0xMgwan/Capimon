import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeDrift, assertBalanced, UnbalancedTrade, type TradeLeg } from "../src/lib/ledger";
import { quoteBuyTzs, quoteSellQty } from "../src/lib/dseTrading";

/**
 * Test one of three: shillings and tokens each sum to zero after every trade.
 *
 * The legs are built exactly as placeSecurityOrder builds them, from the same
 * quote functions, so this is the real arithmetic rather than a description of
 * it. If the order path ever stops balancing, this is the thing that says so.
 */

const buyLegs = (price: number, tzs: number, feeBps?: number): TradeLeg[] => {
  const q = quoteBuyTzs(price, tzs, feeBps);
  return [
    { side: "customer", userId: "u", kind: "buy", asset: "TZS", amount: -q.tzs },
    { side: "customer", userId: "u", kind: "buy", asset: "CRDB", amount: q.qty },
    { side: "house", account: "fee", asset: "TZS", amount: q.fee },
    { side: "house", account: "float", asset: "TZS", amount: q.netTzs },
    { side: "house", account: "inventory", asset: "CRDB", amount: -q.qty },
  ];
};

const sellLegs = (price: number, qty: number, feeBps?: number): TradeLeg[] => {
  const q = quoteSellQty(price, qty, feeBps);
  return [
    { side: "customer", userId: "u", kind: "sell", asset: "CRDB", amount: -q.qty },
    { side: "customer", userId: "u", kind: "sell", asset: "TZS", amount: q.tzs },
    { side: "house", account: "fee", asset: "TZS", amount: q.fee },
    { side: "house", account: "float", asset: "TZS", amount: -q.netTzs },
    { side: "house", account: "inventory", asset: "CRDB", amount: q.qty },
  ];
};

test("a buy balances in shillings and in shares", () => {
  assert.deepEqual(tradeDrift(buyLegs(2940, 10_000)), {});
});

test("a sell balances in shillings and in shares", () => {
  assert.deepEqual(tradeDrift(sellLegs(2940, 3.4)), {});
});

test("a facility order, which pays no fee, still balances", () => {
  assert.deepEqual(tradeDrift(buyLegs(2940 * 0.99, 10_000_000, 0)), {});
  assert.deepEqual(tradeDrift(sellLegs(2940, 3_435.718, 0)), {});
});

test("prices and sizes across four orders of magnitude all balance", () => {
  for (const price of [1, 7.5, 445, 2940, 8_700, 123_456.78]) {
    for (const tzs of [5_000, 99_999, 1_000_000, 250_000_000]) {
      const drift = tradeDrift(buyLegs(price, tzs));
      assert.deepEqual(drift, {}, `buy ${tzs} @ ${price} drifted by ${JSON.stringify(drift)}`);
    }
    for (const qty of [0.000001, 1, 3.333333, 90_210.5]) {
      const drift = tradeDrift(sellLegs(price, qty));
      assert.deepEqual(drift, {}, `sell ${qty} @ ${price} drifted by ${JSON.stringify(drift)}`);
    }
  }
});

test("the house keeps the rounding the customer does not get", () => {
  // A buy floors the shares, so a fraction of a shilling stays as backing.
  // It must stay somewhere the books can see, not vanish.
  const q = quoteBuyTzs(2940, 10_000);
  const legs = buyLegs(2940, 10_000);
  assert.ok(q.qty * 2940 < q.netTzs, "flooring should leave a remainder");
  assert.deepEqual(tradeDrift(legs), {}, "and the remainder must not break the balance");
});

test("a trade that does not balance is refused, and says by how much", () => {
  const legs: TradeLeg[] = [
    { side: "customer", userId: "u", kind: "buy", asset: "TZS", amount: -10_000 },
    { side: "customer", userId: "u", kind: "buy", asset: "CRDB", amount: 3.4 },
    { side: "house", account: "float", asset: "TZS", amount: 9_750 },
    { side: "house", account: "inventory", asset: "CRDB", amount: -3.4 },
    // the 250 fee leg is missing
  ];
  assert.deepEqual(tradeDrift(legs), { TZS: -250 });
  assert.throws(() => assertBalanced(legs), UnbalancedTrade);
});

test("shares credited without payment taken are refused", () => {
  assert.throws(() => assertBalanced([
    { side: "customer", userId: "u", kind: "buy", asset: "CRDB", amount: 100 },
    { side: "house", account: "inventory", asset: "CRDB", amount: -100 },
    { side: "house", account: "float", asset: "TZS", amount: 294_000 },
  ]), UnbalancedTrade);
});

test("an empty trade balances trivially", () => {
  assert.deepEqual(tradeDrift([]), {});
});
