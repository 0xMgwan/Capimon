import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify, nextAttemptAfter, MAX_ATTEMPTS, BACKOFF_MIN, type Party,
} from "../src/lib/settlementQueue";

/**
 * Whether a settled trade needs a transaction.
 *
 * The ledger has already settled it and the customer has already been told
 * their position is theirs, so the only question left is whether tokens have
 * to move between custodians — and getting that wrong is expensive in one
 * direction and dishonest in the other. Sending when nothing changed hands
 * burns gas to record CAPX paying itself; not sending when it did leaves a
 * customer holding a claim the chain does not back.
 */

/** CAPX's own wallet: the custodian of a customer's claim and of any maker
    whose tokens sit in a sub-account. */
const CAPX = "0x7ff9a98b0769647213e5599ddc805317b1b402fa";
const BANK = "0x6aaabcd0083e0ee91deeb6a6bb06414cceb97901";

const custodial = (over: Partial<Party> = {}): Party =>
  ({ custodian: CAPX, canSettle: true, reason: null, ...over });

const external = (over: Partial<Party> = {}): Party =>
  ({ custodian: BANK, canSettle: true, reason: null, ...over });

test("a trade between two custodial parties sends nothing", () => {
  /* Today's every trade. The same wallet holds the token before and after;
     only the ledger's note of who it is held for has changed. */
  const c = classify(custodial(), custodial());
  assert.equal(c.kind, "internal");
  assert.equal(c.status, "internal");
  assert.match(c.reason!, /one custodian on both sides/);
});

test("internal is an answer, not a deferral", () => {
  /* It must never be 'pending', or the queue would grow a backlog of trades
     waiting for a transaction that should never be sent. */
  const c = classify(custodial(), custodial());
  assert.notEqual(c.status, "pending");
  assert.notEqual(c.status, "blocked");
});

test("a maker with its own custody makes the trade external", () => {
  /* The property that matters: onboarding a real counterparty changes the
     answer without changing the code. */
  const c = classify(custodial(), external());
  assert.equal(c.kind, "external");
  assert.equal(c.status, "pending");
  assert.equal(c.reason, null);
});

test("either direction crosses custody", () => {
  assert.equal(classify(external(), custodial()).kind, "external");
  assert.equal(classify(custodial(), external()).kind, "external");
});

test("two makers at the same custodian do not move tokens either", () => {
  /* Falls out of comparing custodians rather than asking who is CAPX: two
     banks sharing a custodian trade without anything leaving it. */
  assert.equal(classify(external(), external()).kind, "internal");
});

test("two different outside custodians do cross", () => {
  const other = external({ custodian: "0x400110946852e0c2c12b6bfc26e0a0909904e889" });
  assert.equal(classify(external(), other).kind, "external");
});

test("a crossing trade that cannot settle is blocked, not dropped", () => {
  /* The case that matters most: tokens should have moved and cannot. The
     ledger has already promised the customer their position. */
  const c = classify(custodial(), external({ canSettle: false, reason: "not approved in the investor registry" }));
  assert.equal(c.kind, "external");
  assert.equal(c.status, "blocked");
  assert.match(c.reason!, /seller cannot settle/);
  assert.match(c.reason!, /not approved in the investor registry/);
});

test("the blocked reason names which side is at fault", () => {
  const buyerBad = classify(external({ canSettle: false, reason: "frozen" }), custodial());
  assert.match(buyerBad.reason!, /buyer cannot settle/);
  const sellerBad = classify(custodial(), external({ canSettle: false, reason: "frozen" }));
  assert.match(sellerBad.reason!, /seller cannot settle/);
});

test("an unsettleable party is irrelevant when nothing crosses custody", () => {
  /* One custodian both sides, and it cannot settle. Not blocked: there is
     nothing to send, so nothing is being prevented. */
  const c = classify(
    custodial({ canSettle: false, reason: "not approved" }),
    custodial({ canSettle: false, reason: "not approved" }));
  assert.equal(c.status, "internal");
});

test("casing in an address cannot split one custodian into two", () => {
  /* Addresses are stored lowercase, but one arriving checksummed from
     elsewhere must not read as a different wallet and turn a no-op into a
     transfer CAPX would make to itself. */
  const c = classify(custodial(), custodial({ custodian: CAPX.toUpperCase() }));
  assert.equal(c.kind, "internal");
});

test("a side with no custodian at all is a gap, not a custody arrangement", () => {
  const c = classify(custodial(), external({ custodian: null }));
  assert.equal(c.status, "blocked");
  assert.match(c.reason!, /no custodian address/);
});

test("the backoff lengthens and then stops lengthening", () => {
  assert.equal(nextAttemptAfter(0), 1 * 60_000);
  assert.equal(nextAttemptAfter(1), 5 * 60_000);
  assert.equal(nextAttemptAfter(4), 240 * 60_000);
  /* Past the table it holds at the longest rather than reading undefined. */
  assert.equal(nextAttemptAfter(99), 240 * 60_000);
  assert.equal(BACKOFF_MIN.length, MAX_ATTEMPTS);
});

test("retries are finite, so a frozen counterparty surfaces", () => {
  /* Nobody is waiting on a settlement, so retrying forever would hide a
     frozen party or a paused contract behind an endless queue. */
  assert.ok(MAX_ATTEMPTS > 0 && MAX_ATTEMPTS <= 10);
});
