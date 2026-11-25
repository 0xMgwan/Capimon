import { test } from "node:test";
import assert from "node:assert/strict";
import { signGrant, checkGrant, keyFor, TTL_MS } from "../src/lib/imageGrant";
import type { ViewerRole } from "../src/lib/adminAuth";

/**
 * The permit that replaced a desk token in an image URL.
 *
 * What has to hold: it opens one document and not the next one, it stops
 * working, it cannot be minted or verified by a deployment that configured
 * nothing, and the role inside it cannot be edited into a different one.
 */

const TOKENS: Record<ViewerRole, string> = {
  admin: "admin-token-for-tests",
  fimco: "fimco-token-for-tests",
  dse: "dse-token-for-tests",
};
const tokenFor = (r: ViewerRole) => TOKENS[r];

const ID = "4fced0f1-2bad-4dad-a614-05d984262554";
const OTHER = "0c6a52f3-8bd5-4e8a-9c21-7d4e5f6a8b90";

const mint = (role: ViewerRole = "admin", id = ID, which: "doc" | "selfie" = "doc", now?: number) =>
  signGrant({ role, id, which }, TOKENS[role], now);

test("a freshly minted grant opens the document it names", () => {
  const g = mint();
  assert.ok(g);
  assert.deepEqual(checkGrant(g, { id: ID, which: "doc" }, tokenFor), { ok: true, role: "admin" });
});

test("it does not open a different submission", () => {
  /* The failure this replaces: one URL in hand, every other customer's
     documents a single edited id away. */
  const g = mint();
  assert.deepEqual(
    checkGrant(g!, { id: OTHER, which: "doc" }, tokenFor),
    { ok: false, reason: "wrong_document" });
});

test("it does not open the other side of the same submission", () => {
  const g = mint("admin", ID, "doc");
  assert.deepEqual(
    checkGrant(g!, { id: ID, which: "selfie" }, tokenFor),
    { ok: false, reason: "wrong_document" });
});

test("it lapses", () => {
  const now = Date.now();
  const g = mint("admin", ID, "doc", now)!;
  assert.ok(checkGrant(g, { id: ID, which: "doc" }, tokenFor, now + TTL_MS - 1).ok);
  assert.deepEqual(
    checkGrant(g, { id: ID, which: "doc" }, tokenFor, now + TTL_MS + 1),
    { ok: false, reason: "expired" });
});

test("a grant minted by one role cannot be re-labelled as another", () => {
  /* The role is read from the payload before the signature can be checked,
     because it selects the key. So the attack to rule out is editing it: the
     forged role derives a key the forger cannot sign under. */
  const g = mint("dse")!;
  const [payload, sig] = g.split(".");
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  assert.ok(decoded.startsWith("dse|"));
  const forged = Buffer.from(decoded.replace("dse|", "admin|"), "utf8").toString("base64url");
  assert.deepEqual(
    checkGrant(`${forged}.${sig}`, { id: ID, which: "doc" }, tokenFor),
    { ok: false, reason: "bad_signature" });
});

test("the signature cannot be dropped or replaced", () => {
  const g = mint()!;
  const [payload] = g.split(".");
  for (const bad of [payload, `${payload}.`, `${payload}.AAAA`, "", ".", "junk"]) {
    const r = checkGrant(bad, { id: ID, which: "doc" }, tokenFor);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
  }
});

test("a deployment that configured nothing mints nothing and verifies nothing", () => {
  /* Without this, every grant for an unconfigured role would be signed under
     a key derived from the empty string — which an attacker also has. */
  assert.equal(keyFor(""), null);
  assert.equal(signGrant({ role: "dse", id: ID, which: "doc" }, ""), null);
  const g = mint()!;
  assert.deepEqual(
    checkGrant(g, { id: ID, which: "doc" }, () => ""),
    { ok: false, reason: "not_configured" });
});

test("a crafted id cannot move the boundary between fields", () => {
  /* The payload is delimited, so an id carrying the separator would let a
     caller write their own expiry or role. Minting refuses a non-uuid. */
  assert.equal(signGrant({ role: "admin", id: `${ID}|admin`, which: "doc" }, TOKENS.admin), null);
  assert.equal(signGrant({ role: "admin", id: "not-a-uuid", which: "doc" }, TOKENS.admin), null);
});

test("the token itself never appears in the grant", () => {
  const g = mint()!;
  const decoded = Buffer.from(g.split(".")[0], "base64url").toString("utf8");
  assert.ok(!g.includes(TOKENS.admin));
  assert.ok(!decoded.includes(TOKENS.admin));
});
