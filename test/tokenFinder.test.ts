import { test } from "node:test";
import assert from "node:assert/strict";
import { findToken, findExpiry } from "../src/lib/dseCustody";

/**
 * Finding a bearer token in a response whose field names nobody documented.
 *
 * The risk this carries is specific: picking the wrong string sends an
 * arbitrary value from the exchange's response as an Authorization header.
 * So what matters is not only that it finds a token, but that it declines
 * everything that merely looks long.
 */

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYXB4Iiwicm9sZSI6InN0YWtlaG9sZGVyIn0.abcdefghijklmnop";
const OPAQUE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

test("the OAuth name is found", () => {
  assert.equal(findToken({ access_token: OPAQUE })?.value, OPAQUE);
});

test("their envelope is found, wrapped in data", () => {
  /* The shape their other endpoints use. */
  const r = findToken({ code: "2000", success: true, data: { accessToken: JWT } });
  assert.equal(r?.value, JWT);
  assert.equal(r?.path, "data.accessToken");
});

test("a token under a name nobody guessed is still found", () => {
  /* The case this exists for: 200, a token present, and the field called
     something the client never checked. */
  assert.equal(findToken({ data: { token: OPAQUE } })?.value, OPAQUE);
  assert.equal(findToken({ result: { bearerToken: OPAQUE } })?.value, OPAQUE);
  assert.equal(findToken({ payload: { authToken: OPAQUE } })?.value, OPAQUE);
});

test("a JWT is taken even under a meaningless key", () => {
  /* Three base64 segments: nothing else in a response looks like that. */
  assert.equal(findToken({ data: { value: JWT } })?.value, JWT);
});

test("an access token outranks a refresh token", () => {
  const r = findToken({ refresh_token: OPAQUE, access_token: JWT });
  assert.equal(r?.value, JWT);
});

test("a shallower token wins a tie", () => {
  /* A wrapper's own token sits above anything nested inside it. */
  const r = findToken({ token: OPAQUE, data: { token: JWT } });
  assert.equal(r?.path, "token");
});

test("long strings that are not tokens are declined", () => {
  /* The dangerous case: sending a timestamp or a message as a bearer. */
  assert.equal(findToken({ message: "The stakeholder request was accepted successfully" }), null);
  assert.equal(findToken({ timestamp: "2026-11-27T10:00:00.000000000Z" }), null);
  assert.equal(findToken({ description: "Dar es Salaam Stock Exchange PLC stakeholder" }), null);
});

test("a short value under a token key is declined", () => {
  /* "none", "n/a", an empty placeholder — all plausible, none usable. */
  assert.equal(findToken({ access_token: "none" }), null);
  assert.equal(findToken({ data: { token: "" } }), null);
});

test("a response with nothing token-shaped fails rather than improvising", () => {
  assert.equal(findToken({ code: "4000", success: false, errors: ["Invalid request"] }), null);
  assert.equal(findToken({}), null);
  assert.equal(findToken(null), null);
});

// ── the lifetime ─────────────────────────────────────────────────────────

test("the lifetime is found under any of its usual names", () => {
  assert.equal(findExpiry({ expires_in: 471599 }), 471599);
  assert.equal(findExpiry({ data: { expiresIn: 3600 } }), 3600);
  assert.equal(findExpiry({ data: { ttl: 900 } }), 900);
});

test("a timestamp in disguise is not taken as a lifetime", () => {
  /* Seconds since the epoch would park the cache decades out, and every
     call after the real expiry would fail with a token believed good. */
  assert.equal(findExpiry({ expiresAt: 1800000000 }), null);
});

test("nothing found means nothing, not zero", () => {
  assert.equal(findExpiry({ code: "2000" }), null);
  assert.equal(findExpiry({ expires_in: 0 }), null);
});
