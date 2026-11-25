import { test } from "node:test";
import assert from "node:assert/strict";
import { dealRef } from "../src/lib/dseOversight";

/**
 * The reference a DSE trade is quoted by.
 *
 * It stands where a chain transaction would and there is no chain behind it,
 * so the only thing that makes it worth more than a row number is that it is
 * computed from the trade rather than assigned to it. These check exactly
 * that: the same trade always gives the same reference, and a trade whose
 * figures moved does not give the one that was written down.
 */
const trade = {
  id: "7c1f0a9e-4b2d-4a51-9f33-2c8e6d5b1a04",
  side: "buy", symbol: "CRDB",
  qty: "250.00000000", price: "570.000000", cash: "142500.00",
  status: "settled",
  created_at: "2026-11-24T11:01:43.221Z",
  settled_at: "2026-11-24T11:01:44.880Z",
};

test("the reference names the security and the day it was placed", () => {
  const ref = dealRef(trade);
  assert.match(ref, /^CRDB-261124-[0-9A-F]{8}$/);
});

test("the same trade gives the same reference every time", () => {
  assert.equal(dealRef(trade), dealRef({ ...trade }));
});

test("a Date and its ISO string are the same trade", () => {
  assert.equal(
    dealRef(trade),
    dealRef({ ...trade, created_at: new Date(trade.created_at),
              settled_at: new Date(trade.settled_at) }),
  );
});

test("the day is read in UTC, so two readers get one reference", () => {
  /* 00:30 in Dar es Salaam on the 25th is 21:30 UTC on the 24th. A reference
     that moved with the reader's clock would be two references for one trade. */
  const late = { ...trade, created_at: "2026-11-24T21:30:00.000Z" };
  assert.ok(dealRef(late).startsWith("CRDB-261124-"));
});

test("a changed quantity no longer matches the reference on file", () => {
  const onFile = dealRef(trade);
  assert.notEqual(dealRef({ ...trade, qty: "251.00000000" }), onFile);
  assert.notEqual(dealRef({ ...trade, price: "575.000000" }), onFile);
  assert.notEqual(dealRef({ ...trade, cash: "143000.00" }), onFile);
  assert.notEqual(dealRef({ ...trade, status: "failed" }), onFile);
  assert.notEqual(dealRef({ ...trade, settled_at: null }), onFile);
});

test("two trades in the same security on the same day are told apart", () => {
  const other = { ...trade, id: "0b9d2f31-6a4c-4e88-b1d7-3f5a0c2e9b17" };
  assert.notEqual(dealRef(other), dealRef(trade));
});

test("a reference could not be mistaken for a chain transaction", () => {
  const ref = dealRef(trade);
  assert.ok(!ref.startsWith("0x"));
  assert.ok(ref.length < 30);
});
