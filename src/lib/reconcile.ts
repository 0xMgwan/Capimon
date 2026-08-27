import "server-only";
import { db, migrate } from "./db";
import { record } from "./ledger";
import { checkSolvency } from "./solvency";
import { getSwapRate } from "./ntzs";

/**
 * Finishes an order that failed after its shillings were already converted.
 *
 * A shilling buy swaps TZS to USDC before it trades. The swap cannot be undone,
 * so if the trade then fails the customer's money is USDC — but the ledger goes
 * on claiming shillings the omnibus no longer holds. That is an unbacked
 * liability, and it pauses trading for everyone until it is cleared.
 *
 * This is repair, not discretion: the unwind is the missing half of the order,
 * so it belongs to the same background process that settles deposits rather
 * than waiting on someone to notice and press a button. Both figures are
 * derived — the shortfall from the solvency check, the account from the failed
 * order that caused it — and it refuses when no failed order explains the
 * drift, so it can never invent a correction.
 */
export async function reconcileSwapDrift(): Promise<{
  applied: boolean;
  reason?: string;
  orderId?: string;
  userId?: string;
  movedTzs?: number;
  creditedUsdc?: number;
}> {
  const solvency = await checkSolvency();
  if (solvency.unavailable) return { applied: false, reason: solvency.unavailable };

  const tzs = solvency.assets.find((a) => a.asset === "TZS");
  const drift = tzs ? tzs.owed - tzs.held : 0;
  // A shilling or two is rounding, not an interrupted order.
  if (!(drift > 1)) return { applied: false, reason: "No shilling drift to reconcile." };

  await migrate();
  const sql = db();

  // A failed shilling buy: usdc_amount is null because the order was priced in
  // TZS, and no unwind has been written for it yet.
  const candidates = await sql<{ id: string; user_id: string }[]>`
    select o.id::text, o.user_id::text
      from capx.orders o
     where o.side = 'buy' and o.status = 'failed' and o.usdc_amount is null
       and not exists (
         select 1 from capx.ledger_entries l where l.ref = o.id::text || ':unwind-tzs')
     order by o.created_at desc
     limit 1`;

  if (!candidates.length) {
    return {
      applied: false,
      reason: `A ${Math.round(drift).toLocaleString()} TZS shortfall exists but no failed shilling order ` +
              `explains it — not correcting a balance without knowing whose it is.`,
    };
  }

  const { id: orderId, user_id: userId } = candidates[0];

  // Value the converted shillings at the live rate: that is what the swap
  // produced, and what the customer should now hold.
  const rate = await getSwapRate("NTZS", "USDC", Math.max(1000, Math.round(drift)));
  const usdc = Number(rate.expectedOutput ?? 0);
  if (!(usdc > 0)) return { applied: false, reason: "No shilling rate is available to value the correction." };

  const result = await record([
    { userId, kind: "adjustment", asset: "TZS", amount: (-drift).toString(),
      ref: `${orderId}:unwind-tzs`,
      metadata: { orderId, reason: "order failed after the shilling swap" } },
    { userId, kind: "adjustment", asset: "USDC", amount: usdc.toString(),
      ref: `${orderId}:unwind-usdc`,
      metadata: { orderId, reason: "shillings already converted; held as USDC" } },
  ]);

  return {
    applied: !result.duplicate,
    orderId,
    userId,
    movedTzs: Math.round(drift),
    creditedUsdc: Number(usdc.toFixed(6)),
  };
}

/**
 * Writes balances down to what is actually held, per asset.
 *
 * The last resort, for money that left without the ledger learning of it — a
 * payout that settled while the bookkeeping after it failed, before the debit
 * was moved ahead of the payout. There is no local record of such a transfer to
 * derive from, so the only evidence is the gap between owed and held.
 *
 * Because it reduces a customer's balance it will not guess whose: an asset
 * held by exactly one account is unambiguous, and anything else is reported and
 * left alone for an explicit correction. The shortfall itself is measured, not
 * typed, and every entry carries its reason.
 */
export async function reconcileShortfall(): Promise<{
  applied: boolean;
  corrections: { asset: string; amount: number; userId: string }[];
  skipped: string[];
}> {
  const solvency = await checkSolvency();
  const corrections: { asset: string; amount: number; userId: string }[] = [];
  const skipped: string[] = [];
  if (solvency.unavailable) return { applied: false, corrections, skipped: [solvency.unavailable] };

  await migrate();
  const sql = db();
  const stamp = Math.floor(Date.now() / 60_000); // a minute's granularity keeps repeats idempotent

  for (const a of solvency.assets) {
    const short = a.owed - a.held;
    if (!(short > 0) || a.covered) continue;

    const holders = await sql<{ user_id: string; balance: string }[]>`
      select user_id::text, sum(amount)::text as balance
        from capx.ledger_entries
       where asset = ${a.asset}
       group by user_id having sum(amount) > 0`;

    if (holders.length !== 1) {
      skipped.push(
        `${a.asset}: ${short.toFixed(a.asset === "TZS" ? 0 : 6)} short across ${holders.length} accounts — ` +
        `correct it explicitly rather than choosing whose balance to reduce.`);
      continue;
    }

    const userId = holders[0].user_id;
    // Never write a balance below zero, whatever the measured gap says.
    const amount = Math.min(short, Number(holders[0].balance));
    if (!(amount > 0)) continue;

    await record([
      { userId, kind: "adjustment", asset: a.asset, amount: (-amount).toString(),
        ref: `reconcile:shortfall:${a.asset}:${stamp}`,
        metadata: { reason: "balance exceeded what is held — funds left without a matching debit" } },
    ]);
    corrections.push({ asset: a.asset, amount, userId });
  }

  return { applied: corrections.length > 0, corrections, skipped };
}
