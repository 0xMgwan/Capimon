import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dealRef, tradeLeaf, canonicalTrade, merkleRoot, anchorPayload,
  eatDay, eatDayBounds, previousEatDay, EMPTY_ROOT, ANCHOR_TAG,
} from "../src/lib/dseAnchor";

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
  assert.match(dealRef(trade), /^CRDB-261124-[0-9A-F]{8}$/);
});

test("the reference carries the front of its own leaf", () => {
  /* So somebody holding a reference can find their trade in the day's
     manifest without being handed a second identifier to track. */
  const ref = dealRef(trade);
  assert.equal(ref.split("-")[2].toLowerCase(), tradeLeaf(trade).slice(0, 8));
});

test("the canonical line names nobody", () => {
  /* The root goes onchain in public. A leaf that could be linked back to a
     person is the one kind that must never be published. */
  const line = canonicalTrade(trade);
  assert.ok(!/@/.test(line));
  assert.equal(line.split("|").length, 8);
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

test("the day is the exchange's own, not the server's", () => {
  /* 21:30 UTC on the 24th is half past midnight on the 25th in Dar. The
     trade belongs to the exchange's Tuesday, not to UTC's Monday, and a
     reference that disagreed with the anchor covering it would be useless
     for finding the trade in that day's manifest. */
  const late = { ...trade, created_at: "2026-11-24T21:30:00.000Z" };
  assert.ok(dealRef(late).startsWith("CRDB-261125-"));
  assert.equal(eatDay("2026-11-24T21:30:00.000Z"), "2026-11-25");
  assert.equal(eatDay("2026-11-24T20:59:59.000Z"), "2026-11-24");
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

/* ------------------------------------------------------------------ */

import { createHash } from "node:crypto";

const h = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const pair = (a: string, b: string) =>
  createHash("sha256").update(Buffer.from(a + b, "hex")).digest("hex");

/**
 * The tree, checked against hashes computed by hand rather than against
 * itself. A Merkle implementation tested only for self-consistency passes
 * every test while being a tree nobody else can reproduce, which is the one
 * failure that matters here: the whole point is that DSE derives the same
 * number from the same trades without running this code.
 */
test("one leaf is its own root", () => {
  assert.equal(merkleRoot([h("a")]), h("a"));
});

test("two leaves hash as bytes, not as text", () => {
  const [a, b] = [h("a"), h("b")].sort();
  assert.equal(merkleRoot([h("a"), h("b")]), pair(a, b));
  /* Hashing the hex strings instead would be a different tree that looks
     just as plausible, so pin the difference. */
  assert.notEqual(merkleRoot([h("a"), h("b")]), h(a + b));
});

test("leaves are sorted, so the query's order by does not change the root", () => {
  const leaves = ["d", "a", "c", "b", "e"].map(h);
  const shuffled = ["e", "c", "a", "d", "b"].map(h);
  assert.equal(merkleRoot(shuffled), merkleRoot(leaves));
});

test("an odd leaf is carried up, never paired with a copy of itself", () => {
  const [a, b, c] = [h("a"), h("b"), h("c")].sort();
  /* Duplicating the odd one is the classic construction and the classic
     construction is where Bitcoin's duplicate-transaction flaw came from. */
  assert.equal(merkleRoot([h("a"), h("b"), h("c")]), pair(pair(a, b), c));
  assert.notEqual(merkleRoot([h("a"), h("b"), h("c")]), pair(pair(a, b), pair(c, c)));
});

test("a day with no trades still has a root", () => {
  /* Otherwise "nothing traded" and "no anchor was posted" look identical in
     the chain of anchors, which is exactly the gap an anchor exists to close. */
  assert.equal(merkleRoot([]), EMPTY_ROOT);
  assert.equal(EMPTY_ROOT.length, 64);
});

test("changing one trade changes the root", () => {
  const before = [trade, { ...trade, id: "b" }].map(tradeLeaf);
  const after = [{ ...trade, price: "999.000000" }, { ...trade, id: "b" }].map(tradeLeaf);
  assert.notEqual(merkleRoot(after), merkleRoot(before));
});

test("the payload says what it is, in text a person can read", () => {
  const root = merkleRoot([tradeLeaf(trade)]);
  const data = anchorPayload("2026-11-24", 1, root);
  const text = Buffer.from(data.slice(2), "hex").toString("utf8");
  assert.equal(text, `${ANCHOR_TAG} 2026-11-24 trades=1 root=${root}`);
  /* A supervisor opens this in a block explorer. If it needs decoding first,
     it will not get checked. */
  assert.ok(text.startsWith("CAPX.DSE.ANCHOR.v1 "));
});

test("a day's bounds are midnight to midnight in Dar, in UTC terms", () => {
  const { from, to } = eatDayBounds("2026-11-25");
  assert.equal(from.toISOString(), "2026-11-24T21:00:00.000Z");
  assert.equal(to.toISOString(), "2026-11-25T21:00:00.000Z");
  /* Every instant inside the bounds must report the day they belong to. */
  assert.equal(eatDay(from), "2026-11-25");
  assert.equal(eatDay(new Date(to.getTime() - 1)), "2026-11-25");
  assert.equal(eatDay(to), "2026-11-26");
});

test("the day just closed is yesterday in Dar, not yesterday here", () => {
  /* Run at 00:10 UTC, which is 03:10 in Dar: the day that closed three hours
     ago is the 24th, and anchoring the 25th would anchor a day still open. */
  assert.equal(previousEatDay(new Date("2026-11-25T00:10:00.000Z")), "2026-11-24");
});

// ── what the exchange is shown when a send fails ─────────────────────────

import { describeSendFailure } from "../src/lib/treasury";

/* The error that actually failed an anchor: lines carrying the RPC url, the
   nonce, the signed transaction and the calldata as hex. */
const REAL_429 = [
  "HTTP request failed. Status: 429 URL: https://mainnet.base.org/ Request body:",
  '{"method":"eth_sendRawTransaction","params":["0x02f8d9822105820160830f4240836acf"]}',
  "Request Arguments: from: 0xF97CEfDb52331bd97ae206964467113d0d7B3629",
  "nonce: 352 Details: Too Many Requests",
  "Version: viem@2.55.19",
].join("\n");

test("a rate limit says so, and says it will be retried", () => {
  const m = describeSendFailure(new Error(REAL_429));
  assert.match(m, /rate-limited/);
  assert.match(m, /retried/);
});

test("none of the transaction's internals survive into the message", () => {
  /* The point of the whole function: the exchange's oversight page showed
     the signed transaction, the nonce and the RPC endpoint. */
  const m = describeSendFailure(new Error(REAL_429));
  for (const leak of ["0x", "nonce", "mainnet.base.org", "viem", "eth_sendRawTransaction"]) {
    assert.ok(!m.toLowerCase().includes(leak.toLowerCase()), `leaked ${leak}: ${m}`);
  }
  assert.ok(!m.includes("\n"), "stays one line");
});

test("an empty wallet is named as such, since it needs a person", () => {
  const m = describeSendFailure(new Error("insufficient funds for gas * price + value"));
  assert.match(m, /no ETH on Base/);
});

test("a nonce clash says the transaction may still confirm", () => {
  /* The dangerous reading is "it failed, send another". It did not
     necessarily fail, and sending another is how two anchors exist. */
  assert.match(describeSendFailure(new Error("nonce too low")), /may still confirm/);
  assert.match(describeSendFailure(new Error("already known")), /may still confirm/);
});

test("a timeout does not claim the transaction failed", () => {
  assert.match(describeSendFailure(new Error("The request timed out.")), /may still have been accepted/);
});

test("an unrecognised failure keeps its first line and is capped", () => {
  const long = `${"x".repeat(400)}\nsecond line with the raw transaction`;
  const m = describeSendFailure(new Error(long));
  assert.ok(m.length <= 160, `${m.length} characters`);
  assert.ok(!m.includes("second line"));
});

test("an error with nothing in it still says something", () => {
  assert.ok(describeSendFailure(new Error("")).length > 0);
  assert.ok(describeSendFailure(undefined).length > 0);
});
