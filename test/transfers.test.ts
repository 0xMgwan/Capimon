import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalSecurity } from "../src/lib/transfers";
import { ASSETS } from "../src/lib/assets";

/**
 * Symbol resolution for transfers, tested without a database.
 *
 * This exists because of a real failure: `transferShares` upper-cased the
 * caller's symbol and then asked the ledger for it. The ledger stores a US
 * position as the registry's own spelling — NVDAc — so the lookup asked for
 * NVDAC, found nothing, and every US transfer was refused with "the sender
 * holds 0" while the position sat on the screen.
 *
 * The DSE board hid it completely: CRDB upper-cased is still CRDB. A bug
 * invisible on one of two boards is exactly the kind worth pinning.
 */

const listed = ["CRDB", "NMB", "VODA", "DPRI", ...ASSETS.map((a) => a.symbol)];

test("a US symbol resolves to the ledger's spelling, whatever case was typed", () => {
  for (const typed of ["NVDAc", "NVDAC", "nvdac", "  nVdAc  "]) {
    assert.equal(canonicalSecurity(typed, listed), "NVDAc",
      `${JSON.stringify(typed)} must resolve to the registry's spelling`);
  }
});

test("the hazard is real: US symbols are not their own upper-case", () => {
  const mixed = ASSETS.filter((a) => a.symbol !== a.symbol.toUpperCase());
  assert.ok(mixed.length > 0,
    "if this ever becomes empty the regression below stops being a regression");
  for (const a of mixed) {
    assert.notEqual(a.symbol.toUpperCase(), a.symbol,
      `${a.symbol}: upper-casing changes it, so it must never be used as a ledger key`);
  }
});

test("every listed symbol round-trips to itself", () => {
  for (const s of listed) assert.equal(canonicalSecurity(s, listed), s);
});

test("DSE symbols still resolve, which is why the bug went unnoticed", () => {
  assert.equal(canonicalSecurity("crdb", listed), "CRDB");
  assert.equal(canonicalSecurity("CRDB", listed), "CRDB");
});

test("an unlisted or empty symbol resolves to nothing rather than to something", () => {
  assert.equal(canonicalSecurity("TSLAX", listed), null);
  assert.equal(canonicalSecurity("", listed), null);
  assert.equal(canonicalSecurity("   ", listed), null);
  assert.equal(canonicalSecurity("NVDA", listed), null,
    "the underlying ticker is not the token symbol, and must not silently match it");
});
