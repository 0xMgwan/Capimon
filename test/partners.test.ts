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

test("a deposit is only creditable once its block is safe, not merely mined", async () => {
  const { finalityFrom } = await import("../src/lib/stablecoinDeposits");

  // Mined, many confirmations deep, but the batch has not reached Ethereum.
  // Confirmations are built by the same sequencer a reorg would replace, so
  // depth alone must not be enough.
  const deep = finalityFrom({ blockNumber: 1000n, latest: 1100n, safeHead: 900n });
  assert.equal(deep.safe, false, "100 confirmations must not override an unsafe head");
  assert.equal(deep.confirmations, 101);
  assert.match(deep.waitingFor ?? "", /Ethereum/);

  // Safe head has passed it: creditable.
  const safe = finalityFrom({ blockNumber: 1000n, latest: 1100n, safeHead: 1000n });
  assert.equal(safe.safe, true, "the safe head reaching the block exactly is enough");
  assert.equal(safe.waitingFor, null);

  assert.equal(finalityFrom({ blockNumber: 1000n, latest: 1005n, safeHead: 1200n }).safe, true);
});

test("without a safe head it falls back to counting, and says so", async () => {
  const { finalityFrom } = await import("../src/lib/stablecoinDeposits");

  const short = finalityFrom({ blockNumber: 1000n, latest: 1005n, safeHead: null,
                               minConfirmations: 30 });
  assert.equal(short.safe, false);
  assert.equal(short.confirmations, 6);
  assert.equal(short.waitingFor, "24 more confirmations");

  const enough = finalityFrom({ blockNumber: 1000n, latest: 1040n, safeHead: null,
                                minConfirmations: 30 });
  assert.equal(enough.safe, true);
  assert.equal(enough.waitingFor, null);

  // An unreadable head must never read as confirmed.
  const blind = finalityFrom({ blockNumber: 1000n, latest: null, safeHead: null,
                               minConfirmations: 30 });
  assert.equal(blind.safe, false, "not knowing must never mean yes");
  assert.equal(blind.confirmations, 0);
});

test("a block ahead of the head never reads as confirmed", async () => {
  const { finalityFrom } = await import("../src/lib/stablecoinDeposits");
  const ahead = finalityFrom({ blockNumber: 2000n, latest: 1000n, safeHead: null,
                               minConfirmations: 30 });
  assert.equal(ahead.confirmations, 0, "a negative depth must clamp, not go negative");
  assert.equal(ahead.safe, false);
});
