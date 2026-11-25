import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignature, TOLERANCE_S } from "../src/lib/ntzsWebhook";

/**
 * The whole security boundary on the nTZS webhook route.
 *
 * Everything downstream of it credits money, so the cases that matter are the
 * ones where a check quietly stops checking: an empty secret, a body changed
 * after signing, a yesterday's delivery replayed today.
 */
const SECRET = "whsec_test_only_not_a_real_secret";
const NOW = 1_800_000_000_000; // fixed, so these never depend on the clock
const TS = String(NOW / 1000);
const BODY = JSON.stringify({ event: "deposit.completed", data: { depositId: "abc" } });

const sign = (raw: string, timestamp: string, secret = SECRET) =>
  createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");

test("a genuine delivery is accepted", () => {
  assert.equal(verifySignature({
    raw: BODY, signature: sign(BODY, TS), timestamp: TS, secret: SECRET, now: NOW,
  }), true);
});

test("a body changed after signing is refused", () => {
  const tampered = JSON.stringify({ event: "deposit.completed", data: { depositId: "xyz" } });
  assert.equal(verifySignature({
    raw: tampered, signature: sign(BODY, TS), timestamp: TS, secret: SECRET, now: NOW,
  }), false);
});

test("the signature covers the timestamp, not only the body", () => {
  /* Otherwise a captured delivery could be replayed forever by moving its
     timestamp forward until it was fresh again. */
  const later = String(NOW / 1000 + 10);
  assert.equal(verifySignature({
    raw: BODY, signature: sign(BODY, TS), timestamp: later, secret: SECRET, now: NOW,
  }), false);
});

test("an old delivery is refused however well signed", () => {
  const old = String(NOW / 1000 - TOLERANCE_S - 1);
  assert.equal(verifySignature({
    raw: BODY, signature: sign(BODY, old), timestamp: old, secret: SECRET, now: NOW,
  }), false);
});

test("a delivery from the future is refused too", () => {
  const ahead = String(NOW / 1000 + TOLERANCE_S + 1);
  assert.equal(verifySignature({
    raw: BODY, signature: sign(BODY, ahead), timestamp: ahead, secret: SECRET, now: NOW,
  }), false);
});

test("an unconfigured deployment accepts nothing", () => {
  /* The failure that would matter most: no secret set must mean "refuse
     everything", never "skip the check". */
  assert.equal(verifySignature({
    raw: BODY, signature: sign(BODY, TS, ""), timestamp: TS, secret: "", now: NOW,
  }), false);
  assert.equal(verifySignature({
    raw: BODY, signature: sign(BODY, TS), timestamp: TS, secret: "", now: NOW,
  }), false);
});

test("the wrong secret is refused", () => {
  assert.equal(verifySignature({
    raw: BODY, signature: sign(BODY, TS, "whsec_someone_elses"), timestamp: TS,
    secret: SECRET, now: NOW,
  }), false);
});

test("a missing or nonsense header is refused rather than thrown at", () => {
  for (const [signature, timestamp] of [
    ["", TS], [sign(BODY, TS), ""], ["not-hex", TS], [sign(BODY, TS), "tomorrow"],
    ["abc", TS],
  ]) {
    assert.equal(verifySignature({
      raw: BODY, signature, timestamp, secret: SECRET, now: NOW,
    }), false, `${signature || "(empty)"} / ${timestamp || "(empty)"}`);
  }
});
