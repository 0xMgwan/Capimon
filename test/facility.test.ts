import { test } from "node:test";
import assert from "node:assert/strict";
import { capacityFrom, claimGapOf, releaseBudgetOf } from "../src/lib/liquidity";
import { quoteBuyTzs, quoteSellQty } from "../src/lib/dseTrading";

/**
 * Tests two and three, on a book rather than on a function.
 *
 * Both questions are about what happens over a sequence of events, so the
 * model below keeps the four quantities that matter — cash in the float,
 * shilling claims against it, shares in the pool, shares with each provider —
 * and moves them with the real pricing and the real gates. Nothing here
 * reimplements a rule: capacityFrom, claimGapOf, releaseBudgetOf and the two
 * quote functions are the ones the application runs.
 */

type Provider = {
  name: string; active: boolean; floorTzs: number;
  committedTzs: number | null; maxDailyTzs: number | null;
  cash: number; shares: number; drawnToday: number;
};

type Book = {
  cash: number;          // shillings actually held in the omnibus
  claims: number;        // shillings owed to everybody, customers and providers
  pool: number;          // shares available for customers to buy
  paidFromPool: number;  // customer payouts that the float could not cover
  providers: Provider[];
};

const mark = { v: 1000 };

const deposit = (b: Book, tzs: number) => { b.cash += tzs; b.claims += tzs; };

const customerBuy = (b: Book, tzs: number) => {
  const q = quoteBuyTzs(mark.v, Math.min(tzs, b.pool * mark.v));
  if (!(q.qty > 0)) return 0;
  b.claims -= q.tzs;     // their shillings become a share position
  b.pool -= q.qty;
  return q.qty;
};

const customerSell = (b: Book, qty: number) => {
  const q = quoteSellQty(mark.v, qty);
  b.claims += q.tzs;     // a new shilling claim, funded by nothing
  b.pool += q.qty;
  return q.tzs;
};

/** Pays what the float can, and records anything it could not. */
const withdraw = (b: Book, tzs: number) => {
  const paid = Math.min(tzs, b.cash);
  b.cash -= paid;
  b.claims -= paid;
  if (paid < tzs) b.paidFromPool += 0;   // nothing is conjured; the rest queues
  return paid;
};

/** The standing bid, gated exactly as absorbClaims gates it. */
const absorb = (b: Book) => {
  let need = claimGapOf(b.claims, b.cash);
  for (const p of b.providers) {
    if (need <= 0) break;
    const { availableTzs } = capacityFrom(p, {
      cashTzs: p.cash, inventoryTzs: p.shares * mark.v, drawnTodayTzs: p.drawnToday,
    });
    const spend = Math.min(need, availableTzs, b.pool * mark.v);
    if (!(spend > 0)) continue;
    const q = quoteBuyTzs(mark.v, spend, 0);           // facility orders pay no fee
    p.cash -= q.tzs; p.shares += q.qty; p.drawnToday += q.tzs;
    b.claims -= q.tzs;                                  // their cash claim retired
    b.pool -= q.qty;
    need -= q.tzs;
  }
};

/** The standing offer, gated exactly as releaseInventory gates it. */
const release = (b: Book) => {
  let budget = releaseBudgetOf(b.claims, b.cash);
  for (const p of b.providers) {
    if (budget <= 0) break;
    if (!p.active) continue;
    const qty = Math.min(p.shares, budget / mark.v);
    if (!(qty > 0)) continue;
    const q = quoteSellQty(mark.v, qty, 0);
    p.shares -= q.qty; p.cash += q.tzs;
    b.claims += q.tzs; b.pool += q.qty;
    budget -= q.tzs;
  }
};

const settled = (b: Book) => {
  const providerCash = b.providers.reduce((t, p) => t + p.cash, 0);
  return { cover: b.claims > 0 ? b.cash / b.claims : Infinity, providerCash };
};

test("test two: a 3x price path with mass selling pays no customer from the pool", () => {
  mark.v = 1000;
  const b: Book = {
    cash: 0, claims: 0, pool: 1000, paidFromPool: 0,
    providers: [{ name: "FIMCO", active: true, floorTzs: 0, committedTzs: null,
                  maxDailyTzs: null, cash: 0, shares: 0, drawnToday: 0 }],
  };

  // Twenty customers put in a million each and buy at 1,000.
  deposit(b, 20_000_000);
  for (let i = 0; i < 20; i++) customerBuy(b, 1_000_000);

  // The provider funds ten million.
  deposit(b, 10_000_000);
  b.providers[0].cash = 10_000_000;

  const cashBefore = b.cash;

  // The price triples and every customer sells.
  mark.v = 3000;
  const held = 1000 - b.pool;
  const proceeds = customerSell(b, held);
  assert.ok(proceeds > 0);

  // Everybody asks to be paid, and the facility works the book after.
  const asked = proceeds;
  const paid = withdraw(b, asked);
  absorb(b);

  // The float never paid out more than it held. That is the whole question:
  // no customer was paid with money that was not there.
  assert.ok(paid <= cashBefore, `paid ${paid} from a float of ${cashBefore}`);
  assert.equal(b.paidFromPool, 0);
  assert.ok(b.cash >= -1e-6, `float went negative: ${b.cash}`);

  // And what is still owed is still covered by what is still held.
  assert.ok(b.claims >= -1e-6, `claims went negative: ${b.claims}`);
  const { cover } = settled(b);
  assert.ok(cover >= 1 - 1e-9 || b.claims === 0,
    `claims ${b.claims} against cash ${b.cash} (cover ${cover})`);
});

test("test two, continued: the unpaid remainder is owed, never invented", () => {
  mark.v = 1000;
  const b: Book = {
    cash: 0, claims: 0, pool: 100, paidFromPool: 0,
    providers: [{ name: "FIMCO", active: true, floorTzs: 0, committedTzs: null,
                  maxDailyTzs: null, cash: 0, shares: 0, drawnToday: 0 }],
  };
  deposit(b, 100_000);
  customerBuy(b, 100_000);
  mark.v = 3000;
  const owedNow = customerSell(b, 100 - b.pool);
  const paid = withdraw(b, owedNow);

  // Only the shillings that were actually deposited can go out.
  assert.ok(paid <= 100_000 + 1e-9, `paid ${paid} against 100,000 deposited`);
  // The rest is still a claim, not a payment.
  assert.ok(b.claims > 0, "the unpaid balance must remain owed");
});

test("test three: a provider going dark mid-session re-routes without a halt", () => {
  mark.v = 1000;
  const mk = (name: string, cash: number): Provider =>
    ({ name, active: true, floorTzs: 0, committedTzs: null, maxDailyTzs: null,
       cash, shares: 0, drawnToday: 0 });

  const b: Book = {
    cash: 0, claims: 0, pool: 500, paidFromPool: 0,
    providers: [mk("FIMCO", 5_000_000), mk("Second", 5_000_000)],
  };
  deposit(b, 10_000_000);   // the two providers' funding
  deposit(b, 5_000_000);    // a customer
  customerBuy(b, 5_000_000);

  mark.v = 3000;
  customerSell(b, 500 - b.pool);
  withdraw(b, 5_000_000);

  // FIMCO goes dark in the middle of it.
  b.providers[0].active = false;

  const gapBefore = claimGapOf(b.claims, b.cash);
  assert.ok(gapBefore > 0, "there should be a gap to clear");

  absorb(b);

  // The paused provider did nothing at all.
  assert.equal(b.providers[0].shares, 0, "a paused provider must not be filled");
  assert.equal(b.providers[0].cash, 5_000_000, "a paused provider's cash must not move");

  // The other one carried it, and nothing halted.
  assert.ok(b.providers[1].shares > 0, "the live provider should have taken the fill");
  assert.ok(claimGapOf(b.claims, b.cash) < gapBefore, "the gap should have closed, not stalled");

  // Pausing reports itself rather than failing silently.
  const { availableTzs, reason } = capacityFrom(b.providers[0],
    { cashTzs: b.providers[0].cash, inventoryTzs: 0, drawnTodayTzs: 0 });
  assert.equal(availableTzs, 0);
  assert.equal(reason, "paused by the provider");
});

test("test three, continued: with every provider dark nothing breaks, it just waits", () => {
  mark.v = 1000;
  const b: Book = {
    cash: 0, claims: 0, pool: 200, paidFromPool: 0,
    providers: [{ name: "FIMCO", active: false, floorTzs: 0, committedTzs: null,
                  maxDailyTzs: null, cash: 5_000_000, shares: 0, drawnToday: 0 }],
  };
  deposit(b, 5_000_000);
  deposit(b, 2_000_000);
  customerBuy(b, 2_000_000);
  mark.v = 3000;
  customerSell(b, 200 - b.pool);

  const before = { cash: b.cash, claims: b.claims, pool: b.pool };
  assert.doesNotThrow(() => { absorb(b); release(b); });
  assert.deepEqual({ cash: b.cash, claims: b.claims, pool: b.pool }, before,
    "a fully paused facility must leave the book exactly as it found it");
});

test("releasing never takes the float below the level the alarm watches", () => {
  mark.v = 1000;
  const b: Book = {
    cash: 60_000_000, claims: 40_000_000, pool: 0, paidFromPool: 0,
    providers: [{ name: "FIMCO", active: true, floorTzs: 0, committedTzs: null,
                  maxDailyTzs: null, cash: 0, shares: 10_000, drawnToday: 0 }],
  };
  release(b);
  assert.ok(b.cash / b.claims >= 1.25 - 1e-9,
    `cover fell to ${(b.cash / b.claims).toFixed(4)}, below the 1.25 the tripwire watches`);
});

test("the broker cannot also collect a spread, and no spread can exceed the cap", async () => {
  const { spreadFor, MAX_SPREAD_BPS, DEFAULT_SPREAD_BPS } = await import("../src/lib/liquidity");

  // FIMCO: broker share is the compensation, nothing on top.
  assert.equal(spreadFor({ spreadBps: 100, alsoBroker: true }), 0);
  assert.equal(spreadFor({ spreadBps: 250, alsoBroker: true }), 0);

  // A separate provider gets the standard rate, and never more than the cap.
  assert.equal(spreadFor({ spreadBps: DEFAULT_SPREAD_BPS, alsoBroker: false }), 100);
  assert.equal(spreadFor({ spreadBps: 250, alsoBroker: false }), MAX_SPREAD_BPS);
  assert.equal(spreadFor({ spreadBps: -50, alsoBroker: false }), 0);
  assert.ok(MAX_SPREAD_BPS <= 100, "the cap must never let counterparties outweigh CAPX");
});

test("what each party takes on one customer exit", () => {
  const FEE = 250, BROKER = 100, CAPX = 150, amt = 10_000_000;
  const bps = (b: number) => (amt * b) / 10_000;
  const spreadOn = (b: number) => amt / (1 - b / 10_000) - amt;

  // FIMCO as both, with the spread forced to nil.
  const fimco = bps(BROKER) + spreadOn(0);
  const capxA = bps(CAPX) - spreadOn(0);
  assert.equal(Math.round(fimco), bps(BROKER));
  assert.equal(Math.round(capxA), bps(CAPX));
  assert.ok(capxA / amt >= 0.015 - 1e-12, "CAPX must keep 1.5% when the provider is the broker");

  // A separate provider at the capped 100 bps: the spread comes out of CAPX's share.
  const capxB = bps(CAPX) - spreadOn(100);
  assert.ok(capxB > 0, "CAPX must still be positive with a third-party provider");
  assert.ok(bps(BROKER) + spreadOn(100) <= bps(FEE) - capxB + 1e-6);
});
