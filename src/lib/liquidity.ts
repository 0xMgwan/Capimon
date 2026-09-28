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
  active: boolean;
};

type Row = {
  id: string; name: string; user_id: string; committed_tzs: string | null;
  max_daily_tzs: string | null; floor_tzs: string; band_pct: string | null; active: boolean;
};

const toProvider = (r: Row): Provider => ({
  id: r.id, name: r.name, userId: r.user_id,
  committedTzs: r.committed_tzs === null ? null : Number(r.committed_tzs),
  maxDailyTzs: r.max_daily_tzs === null ? null : Number(r.max_daily_tzs),
  floorTzs: Number(r.floor_tzs),
  bandPct: r.band_pct === null ? null : Number(r.band_pct),
  active: r.active,
});

const SELECT = `id::text, name, user_id::text, committed_tzs::text, max_daily_tzs::text,
                floor_tzs::text, band_pct::text, active`;

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
     where provider_id = ${p.id}::uuid
       and created_at >= date_trunc('day', now() at time zone 'utc')`;
  const drawnTodayTzs = Number(today?.total ?? 0);

  if (!p.active) {
    return { availableTzs: 0, cashTzs, inventoryTzs, drawnTodayTzs, reason: "paused by the provider" };
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
 * Raises shillings by selling inventory to whoever has agreed to buy it.
 *
 * Called when the float cannot cover a payout. Sells the securities customers
 * have handed back — highest inventory first, since that is where the float
 * drained from — through the ordinary order path, so a provider's purchase is
 * priced, recorded and fee-charged exactly like anybody else's. There is no
 * special case for them in the ledger, and there should not be: their
 * position has to be as auditable as a customer's.
 *
 * Returns what it managed to raise, which may be less than asked and may be
 * nothing. The caller decides what to do about that; this only reports.
 */
export async function raiseLiquidity(neededTzs: number): Promise<{ raisedTzs: number; fills: Fill[] }> {
  const fills: Fill[] = [];
  let raisedTzs = 0;
  if (!dbConfigured || !(neededTzs > 0)) return { raisedTzs, fills };

  await migrate();
  const sql = db();

  const all = (await providers()).filter((p) => p.active);
  if (!all.length) return { raisedTzs, fills };

  const { available } = await import("./otc");
  const { readOraclePrice } = await import("./oracle");
  const { dseSecurities } = await import("./dseSecurities");
  const { placeSecurityOrder } = await import("./dseOrders");

  /*
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
    if (raisedTzs >= neededTzs) break;
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

    let room = Math.min(cap.availableTzs, neededTzs - raisedTzs);

    for (const s of stock) {
      if (room <= 0) break;
      if (!(await withinBand(p, s.symbol, s.mark))) continue;

      /* Never more than is actually there to sell, and never a rounding
         fragment: a fill below a share's price buys nothing. */
      const wanted = Math.min(room, s.qty * s.mark);
      if (wanted < s.mark) continue;

      const result = await placeSecurityOrder(buyer, {
        security: s.symbol, side: "buy", amount: Math.floor(wanted),
      }).catch(() => null);
      if (!result?.ok) continue;

      const spent = Number(result.tzs ?? 0);
      const qty = Number(result.qty ?? 0);
      if (!(spent > 0)) continue;

      await sql`
        insert into capx.lp_fills (provider_id, symbol, qty, tzs, order_id)
        values (${p.id}::uuid, ${s.symbol}, ${qty}, ${spent},
                ${result.orderId ? `${result.orderId}` : null}::uuid)`.catch(() => {});

      fills.push({ provider: p.name, symbol: s.symbol, qty, tzs: spent });
      raisedTzs += spent;
      room -= spent;
      s.qty = Math.max(0, s.qty - qty);
    }
  }

  if (fills.length) {
    const { sendMail } = await import("./mail");
    await sendMail({
      subject: `CAPX: ${Math.round(raisedTzs).toLocaleString()} TZS raised from liquidity providers`,
      text:
        `A payout needed more shillings than the float held, so inventory was sold to the ` +
        `standing bid.\\n\\n` +
        fills.map((f) =>
          `${f.provider}: ${f.qty.toFixed(6)} ${f.symbol} for ${Math.round(f.tzs).toLocaleString()} TZS`,
        ).join("\\n") +
        `\\n\\nThey now hold that inventory and recover the shillings when the next customer buys ` +
        `it. Nothing here changes what backs a customer's position: the shares are the same ` +
        `shares, in the same custody.`,
    }).catch(() => {});
  }

  return { raisedTzs, fills };
}
