import { test } from "node:test";
import assert from "node:assert/strict";
import {
  median, liquidityFrom, verdictFor, PARTICIPATION_PCT,
} from "../src/lib/dseDepth";
import { facilitySizingFrom } from "../src/lib/liquidity";

/**
 * The two questions the marks do not answer.
 *
 * How long selling a DSE position would take, and whether the facility
 * standing behind it is the right size. Both are arithmetic over figures read
 * elsewhere, so the reading is not tested here and the judgement is.
 */

const session = (day: string, volume: number) =>
  ({ day, volume, turnoverTzs: volume * 500, close: 500 });

/* Twenty sessions, which is about a trading month on the DSE. */
const CALENDAR = Array.from({ length: 20 }, (_, i) =>
  `2026-10-${String(i + 1).padStart(2, "0")}`);

// ── median ───────────────────────────────────────────────────────────────

test("median of an odd list is the middle one", () => {
  assert.equal(median([5, 1, 3]), 3);
});

test("median of an even list averages the pair", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("median of nothing is zero, not NaN", () => {
  assert.equal(median([]), 0);
});

test("median does not mutate what it was given", () => {
  const xs = [3, 1, 2];
  median(xs);
  assert.deepEqual(xs, [3, 1, 2]);
});

// ── the zero-filling, which is the whole point ───────────────────────────

test("sessions the security did not trade in count as zero volume", () => {
  /*
   * Traded four days out of twenty, 10,000 shares each time. Reading only the
   * rows that came back would call that a 10,000-share median; against the
   * calendar it is zero, because on a typical session there is no market.
   */
  const x = liquidityFrom({
    symbol: "XYZ",
    calendar: CALENDAR,
    sessions: ["2026-10-02", "2026-10-07", "2026-10-13", "2026-10-19"]
      .map((d) => session(d, 10_000)),
    clientHeld: 1_000,
    markTzs: 500,
  });

  assert.equal(x.sessions, 20);
  assert.equal(x.tradedSessions, 4);
  assert.equal(x.tradedPct, 20);
  assert.equal(x.medianVolume, 0, "a typical session has no volume");
  assert.equal(x.meanVolume, 2_000, "40,000 shares over 20 sessions");
  assert.equal(x.daysToCover, Infinity);
  assert.equal(x.verdict, "illiquid");
});

test("the lumpiness ratio is withheld rather than divided by zero", () => {
  const x = liquidityFrom({
    symbol: "XYZ", calendar: CALENDAR,
    sessions: [session("2026-10-02", 10_000)],
    clientHeld: 1, markTzs: 500,
  });
  assert.equal(x.medianVolume, 0);
  assert.equal(x.lumpiness, null);
});

test("a security trading every session reports a real median", () => {
  const x = liquidityFrom({
    symbol: "CRDB", calendar: CALENDAR,
    sessions: CALENDAR.map((d) => session(d, 40_000)),
    clientHeld: 5_000, markTzs: 500,
  });

  assert.equal(x.tradedSessions, 20);
  assert.equal(x.medianVolume, 40_000);
  assert.equal(x.lumpiness, 1, "even volume is not lumpy");
  assert.equal(x.sellablePerSession, 10_000, "a quarter of 40,000");
  assert.equal(x.daysToCover, 0.5);
  assert.equal(x.verdict, "clear");
});

test("one block trade is visible as lumpiness, not as depth", () => {
  /* Nineteen quiet sessions and one crossing. The mean says the market is
     deep; the median says what a seller can expect on the day they need it. */
  const sessions = CALENDAR.map((d, i) => session(d, i === 9 ? 2_000_000 : 1_000));
  const x = liquidityFrom({
    symbol: "XYZ", calendar: CALENDAR, sessions, clientHeld: 50_000, markTzs: 500,
  });

  assert.equal(x.medianVolume, 1_000);
  assert.ok(x.meanVolume > 100_000);
  assert.ok(x.lumpiness !== null && x.lumpiness > 100,
    "a hundredfold gap between mean and median is the finding");
  assert.equal(x.sellablePerSession, 250);
  assert.equal(x.daysToCover, 200);
  assert.equal(x.verdict, "illiquid");
});

test("the participation rate is what scales the answer", () => {
  const x = liquidityFrom({
    symbol: "CRDB", calendar: CALENDAR,
    sessions: CALENDAR.map((d) => session(d, 1_000)),
    clientHeld: 1_000, markTzs: 500,
  });
  /* Held exactly one session's volume: it takes 1 / (participation) sessions. */
  assert.equal(x.daysToCover, 100 / PARTICIPATION_PCT);
});

test("holding nothing takes no sessions, even in a dead security", () => {
  const x = liquidityFrom({
    symbol: "XYZ", calendar: CALENDAR, sessions: [], clientHeld: 0, markTzs: 500,
  });
  assert.equal(x.daysToCover, 0);
  assert.equal(x.verdict, "clear");
});

test("an unreadable mark zeroes the shilling figures and not the session ones", () => {
  const x = liquidityFrom({
    symbol: "XYZ", calendar: CALENDAR,
    sessions: CALENDAR.map((d) => session(d, 4_000)),
    clientHeld: 1_000, markTzs: 0,
  });
  assert.equal(x.positionTzs, 0);
  assert.equal(x.sellablePerSessionTzs, 0);
  assert.equal(x.sellablePerSession, 1_000, "shares are still shares");
  assert.equal(x.daysToCover, 1);
});

test("an empty calendar cannot be read as liquidity", () => {
  const x = liquidityFrom({
    symbol: "XYZ", calendar: [], sessions: [], clientHeld: 100, markTzs: 500,
  });
  assert.equal(x.sessions, 0);
  assert.equal(x.tradedPct, 0);
  assert.equal(x.daysToCover, Infinity);
});

// ── the bands ────────────────────────────────────────────────────────────

test("the verdict bands sit where settlement does", () => {
  assert.equal(verdictFor(0), "clear");
  assert.equal(verdictFor(1), "clear");
  assert.equal(verdictFor(1.01), "days");
  assert.equal(verdictFor(5), "days");
  assert.equal(verdictFor(5.01), "weeks");
  assert.equal(verdictFor(20), "weeks");
  assert.equal(verdictFor(20.01), "illiquid");
  assert.equal(verdictFor(Infinity), "illiquid");
});

// ── facility sizing ──────────────────────────────────────────────────────

const lp = (name: string, committedTzs: number | null, availableTzs: number, active = true) =>
  ({ name, active, committedTzs, availableTzs });

test("the requirement is the gain, not the position", () => {
  /*
   * The case from the model: a customer deposited 10,000, bought shares, and
   * the price tripled. Their shillings never left the float, so the hole a
   * full exit opens is the 20,000 of gain — a facility sized to 30,000 is a
   * third too large and one sized to the 10,000 deposit is short by the lot.
   */
  const s = facilitySizingFrom({
    requiredTzs: 20_000, unrealisedTzs: 20_000,
    providers: [lp("Bidder", 20_000, 20_000)],
  });
  assert.equal(s.requiredTzs, 20_000);
  assert.equal(s.coverPct, 100);
  assert.equal(s.fundingGapTzs, 0);
  assert.equal(s.committedGapTzs, 0);
});

test("an agreed size with no money behind it is reported as both", () => {
  const s = facilitySizingFrom({
    requiredTzs: 20_000, unrealisedTzs: 20_000,
    providers: [lp("Bidder", 50_000, 4_000)],
  });
  assert.equal(s.committedTzs, 50_000);
  assert.equal(s.drawableTzs, 4_000);
  assert.equal(s.fundingGapTzs, 16_000, "a call to the provider");
  assert.equal(s.committedGapTzs, 0, "the terms are already big enough");
  assert.equal(s.coverPct, 20);
});

test("a book that has outgrown its terms is a renegotiation, not a top-up", () => {
  const s = facilitySizingFrom({
    requiredTzs: 60_000, unrealisedTzs: 55_000,
    providers: [lp("Bidder", 20_000, 20_000)],
  });
  assert.equal(s.fundingGapTzs, 40_000);
  assert.equal(s.committedGapTzs, 40_000,
    "fully funded against its agreed size and still short");
});

test("a paused provider contributes neither commitment nor cash", () => {
  const s = facilitySizingFrom({
    requiredTzs: 10_000, unrealisedTzs: 10_000,
    providers: [lp("On", 5_000, 5_000), lp("Off", 50_000, 50_000, false)],
  });
  assert.equal(s.committedTzs, 5_000);
  assert.equal(s.drawableTzs, 5_000);
  assert.equal(s.fundingGapTzs, 5_000);
});

test("a provider with no agreed ceiling suppresses the committed shortfall", () => {
  /* Their null adds nothing to the agreed total, so a shortfall against that
     total would read as terms to renegotiate when no terms were ever set. */
  const s = facilitySizingFrom({
    requiredTzs: 60_000, unrealisedTzs: 60_000,
    providers: [lp("Open", null, 10_000), lp("Capped", 20_000, 20_000)],
  });
  assert.deepEqual(s.uncommitted, ["Open"]);
  assert.equal(s.committedTzs, 20_000);
  assert.equal(s.committedGapTzs, 0);
  assert.equal(s.fundingGapTzs, 30_000, "what they can actually do is still a fact");
});

test("nothing required is not a hundred percent covered", () => {
  /* Null rather than 100: a ratio against zero is not cover, and rendering it
     as full would make an empty book look like a working facility. */
  const s = facilitySizingFrom({
    requiredTzs: 0, unrealisedTzs: -5_000, providers: [lp("Bidder", 10_000, 0)],
  });
  assert.equal(s.coverPct, null);
  assert.equal(s.fundingGapTzs, 0);
  assert.equal(s.unrealisedTzs, -5_000, "a book below cost is reported, not clamped");
});

test("a negative requirement cannot create negative gaps", () => {
  const s = facilitySizingFrom({
    requiredTzs: -1_000, unrealisedTzs: -1_000, providers: [lp("Bidder", 100, 100)],
  });
  assert.equal(s.requiredTzs, 0);
  assert.equal(s.fundingGapTzs, 0);
  assert.equal(s.committedGapTzs, 0);
});

test("no providers at all is zero cover rather than no answer", () => {
  const s = facilitySizingFrom({
    requiredTzs: 20_000, unrealisedTzs: 20_000, providers: [],
  });
  assert.equal(s.drawableTzs, 0);
  assert.equal(s.coverPct, 0);
  assert.equal(s.fundingGapTzs, 20_000);
  assert.equal(s.committedGapTzs, 20_000);
});
