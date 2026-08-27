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
