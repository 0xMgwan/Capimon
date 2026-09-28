import "server-only";
import { createHash } from "crypto";
import { db, dbConfigured, migrate } from "./db";
import { balanceOf } from "./ledger";
import type { SessionUser } from "./auth";

/**
 * The buyer who is always there.
 *
 * A redemption needs shillings, and shillings arrive when somebody buys the
 * tokens the seller handed back. Usually that is the next customer. When it
 * is not, the float drains while inventory piles up — the two always move in
 * opposite directions — and a customer who did nothing wrong cannot be paid.
 *
 * A liquidity provider is an account that keeps a funded balance and has
 * agreed in advance to be that buyer. Because their shillings already sit in
 * the omnibus, like everybody's, the purchase is a ledger reassignment rather
 * than a transfer: no wire, no waiting on a person, nothing external that can
 * fail. That is the whole reason this can be automatic at all.
 *
 * ## What the purchase does, and what it does not
 *
 * It does not raise cash. A DSE order writes two ledger entries and moves no
 * money — the shillings that pay a customer are the ones the provider already
 * deposited, and those were in the omnibus and counted as payout capacity
 * before the bid ever fired.
 *
 * What it does is retire a claim. Paying a customer their gain drains cash
 * while every other balance stands, including the provider's own. The
 * purchase converts the provider's cash claim into a share claim, so the
 * shillings they put in are genuinely free for the customer rather than owed
 * twice. Without it the provider is left holding a cash claim the float no
 * longer covers, which is the same hole moved one seat along.
 *
 * So the facility is prefunding plus an automatic way for the provider to
 * take the position they are being paid to take. Sizing it by a cash gap was
 * wrong and measured something this cannot move; it is sized by the claim
 * gap — what is owed as shillings, less what is held as shillings.
 *
 * ## Why every limit is optional and every one is checked
 *
 * An automatic bid buys at the mark without being asked, including in a
 * falling market — which is exactly when a provider would want to stop.
 * Committed size, a daily cap, a floor under their balance, a price band and
 * their own switch are what keep "automatic" from meaning "blank cheque".
 * They are nullable because the terms are not agreed yet, and they are
 * enforced the moment they are set.
 */

export const lpTokenHash = (token: string) =>
  createHash("sha256").update(token.trim()).digest("hex");

export type Provider = {
  id: string;
  name: string;
  userId: string;
  committedTzs: number | null;
  maxDailyTzs: number | null;
  floorTzs: number;
  bandPct: number | null;
  /** The mark they will not sell below, as a percentage over what they paid. */
  minMarginPct: number | null;
  active: boolean;
};

type Row = {
  id: string; name: string; user_id: string; committed_tzs: string | null;
  max_daily_tzs: string | null; floor_tzs: string; band_pct: string | null;
  min_margin_pct: string | null; active: boolean;
};

const toProvider = (r: Row): Provider => ({
  id: r.id, name: r.name, userId: r.user_id,
  committedTzs: r.committed_tzs === null ? null : Number(r.committed_tzs),
  maxDailyTzs: r.max_daily_tzs === null ? null : Number(r.max_daily_tzs),
  floorTzs: Number(r.floor_tzs),
  bandPct: r.band_pct === null ? null : Number(r.band_pct),
  minMarginPct: r.min_margin_pct === null ? null : Number(r.min_margin_pct),
  active: r.active,
});

const SELECT = `id::text, name, user_id::text, committed_tzs::text, max_daily_tzs::text,
                floor_tzs::text, band_pct::text, min_margin_pct::text, active`;

/** The provider behind a desk token, or null. */
export async function providerByToken(token: string): Promise<Provider | null> {
  if (!dbConfigured || !token.trim()) return null;
  await migrate();
  const [row] = await db()<Row[]>`
    select ${db().unsafe(SELECT)} from capx.liquidity_providers
     where token_hash = ${lpTokenHash(token)}`;
  return row ? toProvider(row) : null;
}

export async function providers(): Promise<Provider[]> {
  if (!dbConfigured) return [];
  await migrate();
  const rows = await db()<Row[]>`
    select ${db().unsafe(SELECT)} from capx.liquidity_providers order by created_at`;
  return rows.map(toProvider);
}

/**
 * What one provider could be asked for right now, and why not more.
 *
 * Every limit is reported alongside the number, because a provider looking at
 * a capacity of zero is owed an explanation of which of their own terms
 * produced it.
 */
export async function capacityOf(p: Provider): Promise<{
  availableTzs: number;
  cashTzs: number;
  inventoryTzs: number;
  drawnTodayTzs: number;
  reason: string | null;
}> {
  await migrate();
  const sql = db();

  const cashTzs = await balanceOf(p.userId, "TZS").catch(() => 0);

  /* What they are already holding, at today's marks. */
  const { dseSecurities } = await import("./dseSecurities");
  const { readOraclePrice } = await import("./oracle");
  const list = await dseSecurities().catch(() => []);
  let inventoryTzs = 0;
  for (const sec of list) {
    const qty = await balanceOf(p.userId, sec.symbol).catch(() => 0);
    if (qty <= 0) continue;
    const mark = await readOraclePrice(sec.symbol).then((q) => q?.price ?? 0).catch(() => 0);
    inventoryTzs += qty * mark;
  }

  const [today] = await sql<{ total: string }[]>`
    select coalesce(sum(tzs), 0)::text as total from capx.lp_fills
     where provider_id = ${p.id}::uuid and side = 'buy'
       and created_at >= date_trunc('day', now() at time zone 'utc')`;
  const drawnTodayTzs = Number(today?.total ?? 0);

  if (!p.active) {
    return { availableTzs: 0, cashTzs, inventoryTzs, drawnTodayTzs, reason: "paused by the provider" };
  }

  /*
   * A provider buys through the ordinary order path, which refuses an
   * unverified account — as it should, since the whole point is that their
   * purchase passes the same checks as a customer's.
   *
   * It is reported here rather than discovered there. Without this the bid
   * simply never fills: raiseLiquidity would ask, the order would be refused,
   * the failure would be swallowed, and the desk would show a healthy
   * capacity against a facility that cannot buy anything. A provider whose
   * account is not verified is owed that sentence, not a number.
   */
  const [acct] = await sql<{ kyc_status: string }[]>`
    select kyc_status from capx.users where id = ${p.userId}::uuid`;
  if ((acct?.kyc_status ?? "none") !== "approved") {
    return {
      availableTzs: 0, cashTzs, inventoryTzs, drawnTodayTzs,
      reason: acct ? `the account is ${acct.kyc_status === "pending" ? "still being verified" : "not verified"}`
                   : "the account no longer exists",
    };
  }

  /* The binding constraint, whichever it is. */
  const limits: { room: number; reason: string }[] = [
    { room: cashTzs - p.floorTzs, reason: "balance is at the agreed floor" },
  ];
  if (p.committedTzs !== null) {
    limits.push({ room: p.committedTzs - inventoryTzs, reason: "committed size is fully drawn" });
  }
  if (p.maxDailyTzs !== null) {
    limits.push({ room: p.maxDailyTzs - drawnTodayTzs, reason: "daily limit reached" });
  }

  const tightest = limits.reduce((a, b) => (b.room < a.room ? b : a));
  const availableTzs = Math.max(0, tightest.room);
  return {
    availableTzs, cashTzs, inventoryTzs, drawnTodayTzs,
    reason: availableTzs > 0 ? null : tightest.reason,
  };
}

/**
 * Whether the published mark is close enough to the exchange to buy against.
 *
 * A standing bid prices from the oracle. If that mark has drifted from the
 * DSE's own close — a stale publish, a halt, a day nobody caught — then
 * buying at it is buying blind, and the provider carries the difference. When
 * no band is agreed, nothing is refused on this ground: an unset term is not
 * a term.
 */
async function withinBand(p: Provider, symbol: string, mark: number): Promise<boolean> {
  if (p.bandPct === null) return true;
  try {
    const { dseQuote } = await import("./dse");
    const q = await dseQuote(symbol);
    const close = Number(q?.close ?? 0);
    if (!(close > 0) || !(mark > 0)) return false;
    return Math.abs(mark - close) / close <= p.bandPct / 100;
  } catch {
    // The exchange being unreadable is not evidence the mark is good.
    return false;
  }
}

export type Fill = { provider: string; symbol: string; qty: number; tzs: number };

/**
 * Retires shilling claims by selling inventory to whoever has agreed to buy it.
 *
 * Called when the ledger owes more shillings than the float holds. Sells the
 * securities customers have handed back — largest position first, since that
 * is where the imbalance came from — through the ordinary order path, so a
 * provider's purchase is priced, recorded and fee-charged exactly like
 * anybody else's. There is no special case for them in the ledger, and there
 * should not be: their position has to be as auditable as a customer's.
 *
 * Returns the claims it managed to retire, which may be less than asked and
 * may be nothing. The caller decides what to do about that; this only
 * reports.
 */
export async function absorbClaims(neededTzs: number): Promise<{ retiredTzs: number; fills: Fill[] }> {
  const fills: Fill[] = [];
  /** Why a provider was asked and did not buy — carried to the desk mail. */
  const refusals: string[] = [];
  let retiredTzs = 0;
  if (!dbConfigured || !(neededTzs > 0)) return { retiredTzs, fills };

  await migrate();
  const sql = db();

  const all = (await providers()).filter((p) => p.active);
  if (!all.length) return { retiredTzs, fills };

  const { available } = await import("./otc");
  const { readOraclePrice } = await import("./oracle");
  const { dseSecurities } = await import("./dseSecurities");
  const { placeSecurityOrder } = await import("./dseOrders");

  /*
   * DSE shares only, and that is not an omission.
   *
   * A US share settles in dollars against a real on-chain market: selling one
   * is an actual swap, so the proceeds and the gain come back as USDC within
   * the same request. It funds its own redemption and there is nothing for a
   * provider to do. If that route is ever too thin to trade, executeSell
   * refuses rather than filling badly — which a standing bid would not fix
   * either, since the problem there is the market, not the float.
   *
   * A DSE share is the opposite: the underlying sits with the custodian, the
   * token has no outside market, and converting it takes days and a willing
   * buyer on the exchange. That gap is the entire reason this exists.
   *
   * Sell what came back, most first.
   *
   * The float drained because customers sold, so the inventory that needs
   * recycling is the inventory that grew. Taking the largest first clears the
   * need in the fewest fills, which matters because each one is a real order
   * with a real fee.
   */
  const live = (await dseSecurities().catch(() => [])).filter((d) => d.status === "live");
  const stock: { symbol: string; qty: number; mark: number }[] = [];
  for (const sec of live) {
    const qty = await available(sec.symbol).catch(() => 0);
    if (!(qty > 0)) continue;
    const mark = await readOraclePrice(sec.symbol).then((q) => q?.price ?? 0).catch(() => 0);
    if (!(mark > 0)) continue;
    stock.push({ symbol: sec.symbol, qty, mark });
  }
  stock.sort((a, b) => b.qty * b.mark - a.qty * a.mark);

  for (const p of all) {
    if (retiredTzs >= neededTzs) break;
    const cap = await capacityOf(p);
    if (cap.availableTzs <= 0) continue;

    const [u] = await sql<{ id: string; email: string; kyc_status: string; name: string | null;
                            username: string | null; phone: string | null; country: string | null;
                            nida_number: string | null }[]>`
      select id::text, email, kyc_status, name, username, phone, country, nida_number
        from capx.users where id = ${p.userId}::uuid`;
    if (!u) continue;
    const buyer = {
      id: u.id, email: u.email, username: u.username, name: u.name, phone: u.phone,
      country: u.country ?? "TZ", avatar: null, ntzsUserId: null,
      kycStatus: u.kyc_status, nidaNumber: u.nida_number,
    } as SessionUser;

    let room = Math.min(cap.availableTzs, neededTzs - retiredTzs);

    for (const s of stock) {
      if (room <= 0) break;
      if (!(await withinBand(p, s.symbol, s.mark))) continue;

      /* Never more than is actually there to sell, and never a rounding
         fragment: a fill below a share's price buys nothing. */
      const wanted = Math.min(room, s.qty * s.mark);
      if (wanted < s.mark) continue;

      const result = await placeSecurityOrder(buyer, {
        security: s.symbol, side: "buy", amount: Math.floor(wanted),
      }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "failed" }));

      /*
       * A refused fill is recorded, not swallowed.
       *
       * This is the path that pays a customer who is waiting, so "it did not
       * work" is not an acceptable amount of detail. Silently continuing is
       * what turned an unverified provider account into a facility that
       * looked funded and bought nothing.
       */
      if (!result.ok) {
        refusals.push(`${p.name}/${s.symbol}: ${"error" in result ? result.error : "refused"}`);
        continue;
      }

      const spent = Number(result.tzs ?? 0);
      const qty = Number(result.qty ?? 0);
      if (!(spent > 0)) continue;

      await sql`
        insert into capx.lp_fills (provider_id, symbol, qty, tzs, order_id, side)
        values (${p.id}::uuid, ${s.symbol}, ${qty}, ${spent},
                ${result.orderId ? `${result.orderId}` : null}::uuid, 'buy')`.catch(() => {});

      fills.push({ provider: p.name, symbol: s.symbol, qty, tzs: spent });
      retiredTzs += spent;
      room -= spent;
      s.qty = Math.max(0, s.qty - qty);
    }
  }

  /*
   * The desk hears when the bid was called on and could not deliver, which
   * matters more than hearing when it worked: a customer is queued behind it.
   */
  if (!fills.length && refusals.length) {
    const { sendMail } = await import("./mail");
    await sendMail({
      subject: "CAPX: the standing bid was called on and bought nothing",
      text:
        `The ledger owed ${Math.round(neededTzs).toLocaleString()} TZS more than the float held, ` +
        `and every provider asked refused the order.\n\n` +
        refusals.join("\n") +
        `\n\nUntil a provider can actually buy — a verified account with a shilling balance — ` +
        `the shilling claims stand against a float that does not cover them.`,
    }).catch(() => {});
  }

  if (fills.length) {
    const { sendMail } = await import("./mail");
    await sendMail({
      subject: `CAPX: ${Math.round(retiredTzs).toLocaleString()} TZS of claims taken on by liquidity providers`,
      text:
        `The ledger owed more shillings than the float held, so inventory was sold to the ` +
        `standing bid.\n\n` +
        fills.map((f) =>
          `${f.provider}: ${f.qty.toFixed(6)} ${f.symbol} for ${Math.round(f.tzs).toLocaleString()} TZS`,
        ).join("\n") +
        `\n\nThose shilling claims are now share claims, so the float covers what is left of ` +
        `it. The provider holds the position until they choose to sell it back — nothing here ` +
        `unwinds it for them. Nothing here changes what backs a customer's position either: ` +
        `the shares are the same shares, in the same custody.`,
    }).catch(() => {});
  }

  return { retiredTzs, fills };
}


/**
 * What is owed in shillings, less what is held in shillings.
 *
 * The number that sizes the standing bid. It is deliberately not the
 * redemption figure: that one asks what every holder selling at once would
 * cost, which is a stress case. This asks what is owed as cash right now —
 * balances somebody could ask for today — against the cash there is.
 *
 * Positive means claims exceed the float, which is the condition a provider
 * exists to clear. Null when it cannot be read, and a null must never be
 * read as zero: not knowing is not the same as being square.
 */
export async function cashClaimGapTzs(): Promise<number | null> {
  try {
    const { omnibusBalances } = await import("./omnibus");
    const { totalLiabilities } = await import("./ledger");
    const [omnibus, liabilities] = await Promise.all([omnibusBalances(), totalLiabilities()]);
    const owed = liabilities.find((l) => l.asset === "TZS")?.amount ?? 0;
    return owed - omnibus.tzs;
  } catch {
    return null;
  }
}

/**
 * Brings shilling claims back under the float, if a provider can take them.
 *
 * Runs after money has actually left — a payout is the thing that opens the
 * gap — and again on every scheduled tick, so an imbalance opened by any
 * other route closes itself rather than waiting to be noticed. Best-effort by
 * design: it never blocks a customer and never throws into a payout path that
 * has already succeeded.
 */
export async function rebalanceClaims(): Promise<{ gapTzs: number; retiredTzs: number } | null> {
  const gapTzs = await cashClaimGapTzs();
  if (gapTzs === null || gapTzs <= 0) return null;
  const { retiredTzs } = await absorbClaims(gapTzs).catch(() => ({ retiredTzs: 0 }));
  return { gapTzs, retiredTzs };
}

/**
 * The other half: putting inventory back where customers can buy it.
 *
 * Absorbing alone is not a facility, it is a one-way ratchet. A provider who
 * only ever buys ends with no cash and a growing position, and the shares they
 * are holding are shares nobody else can buy — `available()` is custody less
 * what clients are owed, and a provider is a client, so every share they
 * absorb leaves the pool until they sell it back.
 *
 * So this is the mirror. It sells inventory through the same ordinary order
 * path, which credits the provider shillings and returns the shares to the
 * pool, and it is gated on the one thing that makes selling safe: the float
 * has to be able to carry the shilling claim it creates.
 */

/**
 * How much cash must remain above what is owed.
 *
 * The same 1.25 the redemption tripwire watches for, deliberately: releasing
 * down to the level that sets off the alarm would be the facility causing the
 * thing it exists to prevent. Selling stops where the warning starts.
 */
const RELEASE_HEADROOM = 1.25;

/**
 * Shillings that can be credited to providers before the float gets thin.
 *
 * The release is itself part of what has to be covered, which is easy to miss
 * and was: selling inventory back credits the provider shillings, so the
 * claim it creates lands on the same side of the ratio it is being checked
 * against. Solving `cash >= (owed + x) * headroom` for x gives the figure
 * below. Checking against `owed` alone overstated the budget by a quarter of
 * itself and released the float straight past the level it was protecting.
 */
export async function releasableTzs(): Promise<number | null> {
  try {
    const { omnibusBalances } = await import("./omnibus");
    const { totalLiabilities } = await import("./ledger");
    const [omnibus, liabilities] = await Promise.all([omnibusBalances(), totalLiabilities()]);
    const owed = liabilities.find((l) => l.asset === "TZS")?.amount ?? 0;
    return omnibus.tzs / RELEASE_HEADROOM - owed;
  } catch {
    return null;
  }
}

/**
 * What a provider paid for what they are still holding, per share.
 *
 * Buys net of sells, so a position part-unwound reports the cost of the part
 * that remains rather than of everything ever bought. Null when the fills
 * cannot account for the balance — a provider who also trades by hand has a
 * cost basis this table never saw, and guessing one to check a margin floor
 * against would be worse than declining to check it.
 */
async function avgCostOf(providerId: string, symbol: string): Promise<number | null> {
  const sql = db();
  const [row] = await sql<{ qty: string; tzs: string }[]>`
    select coalesce(sum(case when side = 'sell' then -qty else qty end), 0)::text as qty,
           coalesce(sum(case when side = 'sell' then -tzs else tzs end), 0)::text as tzs
      from capx.lp_fills where provider_id = ${providerId}::uuid and symbol = ${symbol}`;
  const qty = Number(row?.qty ?? 0);
  const tzs = Number(row?.tzs ?? 0);
  if (!(qty > 0) || !(tzs > 0)) return null;
  return tzs / qty;
}

export type Release = { provider: string; symbol: string; qty: number; tzs: number };

/**
 * Sells provider inventory back into the pool while the float can carry it.
 *
 * Scarcest security first: a symbol customers cannot currently buy is the one
 * where the inventory is doing the most harm sitting still. Every refusal is
 * a reason to skip rather than to stop, because one provider's margin floor
 * says nothing about the next provider's.
 */
export async function releaseInventory(): Promise<{ releasedTzs: number; releases: Release[] } | null> {
  if (!dbConfigured) return null;

  let budget = await releasableTzs();
  if (budget === null || budget <= 0) return null;

  await migrate();
  const sql = db();

  const all = (await providers()).filter((p) => p.active);
  if (!all.length) return null;

  const { available } = await import("./otc");
  const { readOraclePrice } = await import("./oracle");
  const { dseSecurities } = await import("./dseSecurities");
  const { placeSecurityOrder } = await import("./dseOrders");
  const { balanceOf } = await import("./ledger");

  const live = (await dseSecurities().catch(() => [])).filter((d) => d.status === "live");
  const scarcity: { symbol: string; free: number; mark: number }[] = [];
  for (const sec of live) {
    const mark = await readOraclePrice(sec.symbol).then((q) => q?.price ?? 0).catch(() => 0);
    if (!(mark > 0)) continue;
    scarcity.push({ symbol: sec.symbol, free: await available(sec.symbol).catch(() => 0), mark });
  }
  scarcity.sort((a, b) => a.free - b.free);

  const releases: Release[] = [];
  let releasedTzs = 0;

  for (const p of all) {
    if (budget <= 0) break;

    const [u] = await sql<{ id: string; email: string; kyc_status: string; name: string | null;
                            username: string | null; phone: string | null; country: string | null;
                            nida_number: string | null }[]>`
      select id::text, email, kyc_status, name, username, phone, country, nida_number
        from capx.users where id = ${p.userId}::uuid`;
    if (!u) continue;
    const seller = {
      id: u.id, email: u.email, username: u.username, name: u.name, phone: u.phone,
      country: u.country ?? "TZ", avatar: null, ntzsUserId: null,
      kycStatus: u.kyc_status, nidaNumber: u.nida_number,
    } as SessionUser;

    for (const s of scarcity) {
      if (budget <= 0) break;

      const held = await balanceOf(p.userId, s.symbol).catch(() => 0);
      if (!(held > 0)) continue;

      /* A stale mark is as bad to sell on as to buy on. */
      if (!(await withinBand(p, s.symbol, s.mark))) continue;

      /*
       * Their own floor under the price.
       *
       * The bid buys at the mark on a day somebody needed to exit, which is
       * often a day the mark is low. Selling back at any price would let the
       * facility book that as a loss automatically and without being asked.
       * Unset means no floor and it sells at the mark; set and uncheckable
       * means it does not sell, because an unverifiable floor is not a floor.
       */
      if (p.minMarginPct !== null) {
        const cost = await avgCostOf(p.id, s.symbol);
        if (cost === null || s.mark < cost * (1 + p.minMarginPct / 100)) continue;
      }

      const qty = Math.min(held, budget / s.mark);
      if (!(qty > 0) || qty * s.mark < s.mark) continue;

      const result = await placeSecurityOrder(seller, {
        security: s.symbol, side: "sell", amount: qty,
      }).catch(() => null);
      if (!result?.ok) continue;

      const got = Number(result.tzs ?? 0);
      const sold = Number(result.qty ?? 0);
      if (!(got > 0)) continue;

      await sql`
        insert into capx.lp_fills (provider_id, symbol, qty, tzs, order_id, side)
        values (${p.id}::uuid, ${s.symbol}, ${sold}, ${got},
                ${result.orderId ? `${result.orderId}` : null}::uuid, 'sell')`.catch(() => {});

      releases.push({ provider: p.name, symbol: s.symbol, qty: sold, tzs: got });
      releasedTzs += got;
      budget -= got;
      s.free += sold;
    }
  }

  /*
   * No mail for a release.
   *
   * Absorbing is mailed because it happens when something is wrong and
   * somebody should know. This happens when things are going well, and a
   * notification every time the book is healthy is the fastest way to teach
   * a desk to ignore its own alerts. It is on the provider's page and in the
   * fills, where it belongs.
   */
  return releases.length ? { releasedTzs, releases } : null;
}
