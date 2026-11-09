import { test } from "node:test";
import assert from "node:assert/strict";
import { Attribution } from "ox/erc8021";
import { BUILDER_CODE, BUILDER_SUFFIX, attributionOf, isAttributed } from "../src/lib/builderCode";

/**
 * ERC-8021 attribution, pinned where it can break silently.
 *
 * A wrong suffix costs nothing and fails nothing — the transaction still
 * settles, the trade is still correct, and the only symptom is a dashboard
 * that stays empty. That is exactly the kind of fault nobody notices, so the
 * encoding is checked rather than assumed.
 */

test("the suffix encodes the configured code, marker and all", () => {
  assert.ok(BUILDER_SUFFIX, "a code is configured, so a suffix must exist");
  const hex = BUILDER_SUFFIX!.slice(2);

  assert.equal(hex.slice(-32), "80218021802180218021802180218021", "ERC-8021 marker");
  assert.equal(hex.slice(-34, -32), "00", "schema byte");
  assert.equal(parseInt(hex.slice(-36, -34), 16), BUILDER_CODE.length, "length byte");
  assert.equal(
    Buffer.from(hex.slice(0, hex.length - 36), "hex").toString("utf8"),
    BUILDER_CODE,
    "the ASCII must be the code itself, not a hand-copied string that drifted from it",
  );
});

test("it reads back off a transaction that carries it", () => {
  // A call with real arguments, then the suffix past the end of them.
  const call = ("0x12aa3caf" + "ab".repeat(128) + BUILDER_SUFFIX!.slice(2)) as `0x${string}`;
  assert.deepEqual([...attributionOf(call)], [BUILDER_CODE]);
  assert.ok(isAttributed(call));
});

test("an untagged transaction is not claimed as ours", () => {
  const plain = ("0x12aa3caf" + "ab".repeat(128)) as `0x${string}`;
  assert.deepEqual([...attributionOf(plain)], []);
  assert.equal(isAttributed(plain), false);

  // Somebody else's code must not read as ours.
  const theirs = ("0x12aa3caf" + "ab".repeat(128)
    + Attribution.toDataSuffix({ codes: ["bc_someoneelse"] }).slice(2)) as `0x${string}`;
  assert.equal(isAttributed(theirs), false);
  assert.deepEqual([...attributionOf(theirs)], ["bc_someoneelse"]);
});

test("garbage trailing data does not throw or produce a false positive", () => {
  for (const d of ["0x", "0x12aa3caf", "0x" + "00".repeat(64), "0xdeadbeef"]) {
    assert.doesNotThrow(() => attributionOf(d as `0x${string}`));
    assert.equal(isAttributed(d as `0x${string}`), false);
  }
});

test("the suffix is small enough that nobody should think about gas", () => {
  const bytes = (BUILDER_SUFFIX!.length - 2) / 2;
  const nonZero = BUILDER_SUFFIX!.slice(2).match(/.{2}/g)!.filter((b) => b !== "00").length;
  assert.ok(bytes <= 40, `suffix is ${bytes} bytes`);
  // 16 gas per non-zero calldata byte.
  assert.ok(nonZero * 16 < 1000, `adds ${nonZero * 16} gas, which should stay negligible`);
});
