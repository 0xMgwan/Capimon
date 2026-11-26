import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeOf } from "../src/lib/pledges";

/**
 * What a sent instruction amounts to.
 *
 * The exchange gives two answers that do not agree. Their guide calls
 * `data.upstream.accepted` the final confirmation; their email says the CSD
 * validates further during processing. So acceptance alone never reaches
 * `confirmed` here — the holdings have to have moved — and the cost of being
 * wrong in that direction is a wasted poll, against tokens minted on an
 * unapplied lock the other way.
 */

const o = (upstreamAccepted: boolean | null, movedBy: number, quantity = 100) =>
  outcomeOf({ upstreamAccepted, movedBy, quantity });

test("accepted, and the holdings moved: confirmed", () => {
  assert.deepEqual(o(true, 100), { status: "confirmed", reason: null });
});

test("moving by more than asked is still confirmed", () => {
  /* Somebody else's pledge can land in the same window. The question is
     whether ours was applied, not whether the total matches exactly. */
  assert.equal(o(true, 150).status, "confirmed");
});

test("accepted, holdings unmoved: unconfirmed, and it says how far", () => {
  const r = o(true, 40);
  assert.equal(r.status, "unconfirmed");
  assert.match(r.reason!, /40 of 100/);
});

test("acceptance alone is never enough", () => {
  /* The guide calls upstream.accepted final. If that is the accurate half,
     this costs one extra read. If the email is, believing it would mint
     against a lock that was never applied. */
  assert.notEqual(o(true, 0).status, "confirmed");
});

test("an explicit refusal ends it", () => {
  const r = o(false, 0);
  assert.equal(r.status, "failed");
  assert.match(r.reason!, /did not accept/);
});

test("a refusal is failed even if the holdings happen to have moved", () => {
  /* A move alongside a refusal is somebody else's lock, not ours. Reading it
     as our success would back tokens on a stranger's pledge. */
  assert.equal(o(false, 100).status, "failed");
});

test("a missing accepted flag is unconfirmed, never a yes", () => {
  /* Their notes say to treat absent or null as unconfirmed. */
  const r = o(null, 0);
  assert.equal(r.status, "unconfirmed");
  assert.match(r.reason!, /did not say whether it accepted/);
});

test("a null flag with the holdings moved is still confirmed", () => {
  /* The holdings are the evidence. If they moved, the lock is applied,
     whatever the envelope failed to say. */
  assert.equal(o(null, 100).status, "confirmed");
});

test("a backwards move never counts as progress", () => {
  /* confirm() computes movedBy with the sign of the action, so a hold whose
     pledged balance fell arrives here negative and must not pass. */
  assert.equal(o(true, -100).status, "unconfirmed");
});
