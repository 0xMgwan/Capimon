import { test } from "node:test";
import assert from "node:assert/strict";
import { mintKey, hashKey, slugify } from "../src/lib/partners";

/** The parts of the partner layer that decide things, tested without a database. */

test("a key announces its own mode, so a live key in a test config is visible", () => {
  assert.match(mintKey("test").key, /^cpx_test_/);
  assert.match(mintKey("live").key, /^cpx_live_/);
});

test("keys are unique and long enough to not be guessed", () => {
  const keys = new Set(Array.from({ length: 500 }, () => mintKey("live").key));
  assert.equal(keys.size, 500, "every key must be distinct");
  const one = mintKey("live").key;
  // 24 random bytes is 192 bits of entropy, base64url encoded.
  assert.ok(one.length >= 40, `too short: ${one.length}`);
});

test("only the hash is storable, and it matches the key exactly once", () => {
  const { key, hash } = mintKey("live");
  assert.equal(hashKey(key), hash);
  assert.equal(hashKey(` ${key} `), hash, "surrounding whitespace must not change the key");
  assert.notEqual(hashKey(key + "x"), hash);
  assert.equal(hash.length, 64, "sha256 hex");
  assert.ok(!hash.includes(key), "the hash must not contain the key");
});

test("the prefix identifies a key without revealing it", () => {
  const { key, prefix } = mintKey("live");
  assert.ok(key.startsWith(prefix));
  assert.ok(prefix.length < key.length / 2, "a prefix that is most of the key is not a prefix");
});

test("slugs are URL-safe, bounded, and never empty", () => {
  assert.equal(slugify("Acme Financial Services Ltd"), "acme-financial-services-ltd");
  assert.equal(slugify("  Múltiple   Spaces!!  "), "m-ltiple-spaces");
  assert.equal(slugify("!!!"), "partner", "a name with nothing usable still yields a slug");
  assert.equal(slugify(""), "partner");
  assert.ok(slugify("x".repeat(200)).length <= 40);
  for (const s of ["Acme Ltd", "日本の会社", "a/b?c#d", "-leading-and-trailing-"]) {
    const out = slugify(s);
    assert.match(out, /^[a-z0-9-]+$/, `${s} -> ${out}`);
    assert.ok(!out.startsWith("-") && !out.endsWith("-"), `${s} -> ${out}`);
  }
});

test("webhook signatures are an HMAC of the exact bytes sent", async () => {
  const { createHmac } = await import("crypto");
  const secret = "whsec_example";
  const body = JSON.stringify({ id: "evt_1", kind: "order.settled", data: { qty: 1 } });
  const sig = createHmac("sha256", secret).update(body).digest("hex");

  // A receiver verifying the parsed-and-restringified body instead of the raw
  // bytes is the classic way this check silently stops working.
  const reserialised = JSON.stringify(JSON.parse(body));
  assert.equal(createHmac("sha256", secret).update(reserialised).digest("hex"), sig,
    "this payload round-trips, but a partner must still verify raw bytes");
  assert.notEqual(createHmac("sha256", "wrong").update(body).digest("hex"), sig);
  assert.notEqual(createHmac("sha256", secret).update(body + " ").digest("hex"), sig);
});
