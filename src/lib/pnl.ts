import "server-only";
import { db, migrate } from "./db";

/**
 * What each position cost, and what it has made.
 *
 * An investing app that cannot say whether someone is up or down is missing its
 * centre — holdings and a current value do not answer the only question people
 * open it to ask. Nothing new is recorded to work this out: every fill already
 * writes its execution price to the ledger, so cost is recoverable from history
 * that already exists.
 *
 * Average cost, not FIFO. Positions here are fractional and bought in small
 * amounts, so lot tracking would add real complexity for a number that differs
 * only in how a gain is split between realised and unrealised — and average
 * cost is what a customer means by "what I paid".
 *
 * Cost stays in the currency it was paid in. A CRDB share costs shillings and a
 * NVDA share costs dollars, and 2,980 of one is not 2,980 of the other — read
 * as dollars, a third of a CRDB share booked a $998 basis and showed the holder
 * down 99%. Converting here would be worse than wrong in a different way: a
 * cost basis that moves with the exchange rate is not a cost. The figure is
 * tagged with its currency and converted once, at the point something has to
 * put two markets in the same column.
 */

export type PositionCost = {
  asset: string;
  /** Shares still held, from the same entries the balance is built from. */
  qty: number;
  /** What the money below is denominated in. */
  currency: "USD" | "TZS";
  /** Weighted average price paid for the shares still held, in `currency`. */
  avgCost: number;
  /** What those remaining shares cost — qty × avgCost, in `currency`. */
  costBasis: number;
  /** Gains already banked by selling, in `currency`. */
  realised: number;
};

type Row = {
  kind: string;
  asset: string;
  amount: string;
  metadata: { orderId?: string; price?: number; currency?: string } | null;
};

export async function positionCosts(userId: string): Promise<Map<string, PositionCost>> {
  await migrate();

  /*
   * Oldest first: average cost is path-dependent, so the order entries were
   * written in is the order they have to be replayed in.
   *
   * By `created_at`, not by `id`: ids are random uuids, so ordering by them
   * replayed a customer's buys and sells in an arbitrary order and could
   * compute an average cost from a sequence that never happened.
   */
  const rows = await db()<Row[]>`
    select kind, asset, amount::text, metadata
      from capx.ledger_entries
     where user_id = ${userId}
     order by created_at asc, id asc`;

  /*
   * A sell writes its price on the cash leg, not the share leg — the share
   * entry only carries the quantity. Both legs share an orderId, so the prices
   * are collected first and looked up by order when replaying.
   */
  const priceByOrder = new Map<string, number>();
  // The currency travels with the order for the same reason the price does:
  // the share leg carries one and the cash leg the other.
  const currencyByOrder = new Map<string, "USD" | "TZS">();
  for (const r of rows) {
    const orderId = r.metadata?.orderId;
    const price = Number(r.metadata?.price ?? 0);
    if (orderId && price > 0) priceByOrder.set(orderId, price);
    if (orderId && r.metadata?.currency === "TZS") currencyByOrder.set(orderId, "TZS");
  }

  const out = new Map<string, PositionCost>();
  const isCash = (a: string) => a === "USDC" || a === "TZS";

  for (const r of rows) {
    if (isCash(r.asset)) continue;

    const qty = Number(r.amount);
    if (!Number.isFinite(qty) || qty === 0) continue;

    const price = Number(r.metadata?.price ?? 0)
      || (r.metadata?.orderId ? priceByOrder.get(r.metadata.orderId) ?? 0 : 0);

    const currency: "USD" | "TZS" =
      r.metadata?.currency === "TZS" ? "TZS"
      : (r.metadata?.orderId && currencyByOrder.get(r.metadata.orderId)) || "USD";

    const p = out.get(r.asset)
      ?? { asset: r.asset, qty: 0, currency, avgCost: 0, costBasis: 0, realised: 0 };
    // A security is bought in one currency throughout; the first entry settles
    // it rather than letting a later one silently redenominate the basis.
    if (p.qty === 0 && p.costBasis === 0) p.currency = currency;

    if (qty > 0) {
      // A buy, or an adjustment crediting shares. Without a price — a manual
      // correction, say — the shares still count, but they add no cost, which
      // keeps the basis honest rather than inventing one.
      p.costBasis += qty * price;
      p.qty += qty;
    } else {
      const sold = Math.min(-qty, p.qty);
      const basisOut = p.qty > 0 ? (p.costBasis / p.qty) * sold : 0;
      if (price > 0) p.realised += sold * price - basisOut;
      p.costBasis -= basisOut;
      p.qty -= sold;
    }

    // Guard against drift into a negative basis from rounding at 8 decimals.
    if (p.qty <= 0) { p.qty = 0; p.costBasis = 0; }
    p.avgCost = p.qty > 0 ? p.costBasis / p.qty : 0;
    out.set(r.asset, p);
  }

  return out;
}
