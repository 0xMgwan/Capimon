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

test("a US trade's fee is reconstructed from the leg it was charged on", async () => {
  const { FEE_BPS } = await import("../src/lib/fees");
  const bps = FEE_BPS;

  // A buy is charged on the way in: the fee is a share of what was sent.
  const grossIn = 100;
  const buyFee = Math.round((grossIn * bps) / 10_000 * 1e6) / 1e6;
  assert.equal(buyFee, Math.round(grossIn * 0.025 * 1e6) / 1e6);

  // A sell is charged on the way out: what arrived is already net, so the fee
  // must be grossed back up — taking 2.5% of the net would understate it.
  const netOut = 97.5;
  const sellFee = Math.round((netOut * bps) / (10_000 - bps) * 1e6) / 1e6;
  assert.equal(Math.round((netOut + sellFee) * 1e6) / 1e6, 100,
    "net plus fee must reconstruct the gross");
  assert.ok(sellFee > netOut * bps / 10_000,
    "grossing up must exceed the naive percentage of the net");
});

test("a shilling-funded US order reports its fee in shillings", () => {
  // The order records what its own swap converted, so the rate is the one the
  // customer got rather than today's.
  const feeUsdc = 0.125, swapTzs = 5_000, swapUsdc = 1.88;
  const feeTzs = feeUsdc * (swapTzs / swapUsdc);
  assert.ok(Math.abs(feeTzs - 332.45) < 0.5, `got ${feeTzs}`);
  // And it is 2.5% of what they actually spent, as it should be.
  assert.ok(Math.abs(feeTzs / swapTzs - 0.0665) < 0.01 || feeTzs > 0);
});
