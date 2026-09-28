import "server-only";
import { db, dbConfigured, migrate } from "./db";
import type { PayoutDest } from "./ntzs";

/**
 * Paying the people who were told to wait.
 *
 * A queued withdrawal is a promise: the customer's balance was real, the
 * shillings were not there yet, and CAPX said it would send the money. Nothing
 * in a request can keep that promise, because the customer has closed the app.
 * This is the thing that keeps it.
 *
 * It runs on every tick — one indexed query when there is nothing owed — and
 * tries the oldest first, because the person who has waited longest is the one
 * whose patience is closest to running out.
 */

const MAX_ATTEMPTS = 12;

/**
 * Below this a payment is not worth making.
 *
 * Every payout costs a rail fee and arrives as a message on somebody's phone.
 * A pro-rata share of a few hundred shillings spends real money to tell
 * someone almost nothing has happened, so small shares are rolled into the
 * next pass instead.
 */
const MIN_PAYMENT_TZS = 5_000;

export type QueuedRow = { id: string; outstandingTzs: number };

/**
 * How a short float is shared out.
 *
 * Paying the oldest in full until the money runs out is the simplest rule and
 * the harshest one: on a day the float covers half of what is queued, half the
 * customers get everything and half get nothing, decided by who happened to
 * press the button first. Sharing it out means everybody waiting sees
 * something move, which is both fairer and — for anybody who needed part of it
 * today — more useful.
 *
 * Full payment whenever the float can cover everything, because splitting a
 * payout nobody needed to split would be worse than the problem it solves.
 *
 * Shares below the minimum are dropped rather than sent, and whatever is left
 * over after rounding goes to the longest-waiting row that can still use it,
 * so the float is never left holding shillings it could have paid out.
 */
export function proRataSplit(
  rows: QueuedRow[],
  capacityTzs: number,
  minPaymentTzs = MIN_PAYMENT_TZS,
): { id: string; payTzs: number }[] {
  const owed = rows.filter((r) => r.outstandingTzs > 0);
  const total = owed.reduce((t, r) => t + r.outstandingTzs, 0);
  if (!owed.length || !(capacityTzs > 0) || !(total > 0)) return [];

  if (capacityTzs >= total) {
    return owed.map((r) => ({ id: r.id, payTzs: r.outstandingTzs }));
  }

  const pay = new Map<string, number>();
  for (const r of owed) {
    const share = Math.floor((capacityTzs * r.outstandingTzs) / total);
    if (share >= minPaymentTzs) pay.set(r.id, Math.min(share, r.outstandingTzs));
  }

  /* Rounding and dropped dust, given to whoever has waited longest. */
  let spare = capacityTzs - [...pay.values()].reduce((t, v) => t + v, 0);
  for (const r of owed) {
    if (spare < 1) break;
    const already = pay.get(r.id) ?? 0;
    const room = r.outstandingTzs - already;
    if (room <= 0) continue;
    const extra = Math.floor(Math.min(spare, room));
    if (already === 0 && extra < minPaymentTzs) continue;
    if (extra <= 0) continue;
    pay.set(r.id, already + extra);
    spare -= extra;
  }

  return [...pay.entries()].map(([id, payTzs]) => ({ id, payTzs }));
}

type Row = {
  id: string; user_id: string; amount_tzs: string; paid_tzs: string;
  destination: PayoutDest & { label?: string }; attempts: number;
};

export async function reconcileQueue(): Promise<{
  checked: number; sent: number; partial: number; stillShort: number; failed: number;
}> {
  const out = { checked: 0, sent: 0, partial: 0, stillShort: 0, failed: 0 };
  if (!dbConfigured) return out;
  await migrate();
  const sql = db();

  const rows = await sql<Row[]>`
    select id::text, user_id::text, amount_tzs::text, paid_tzs::text, destination, attempts
      from capx.withdrawal_queue
     where status = 'queued'
     order by created_at
     limit 20`;
  if (!rows.length) return out;

  const { payoutCapacityTzs } = await import("./ntzsFunding");
  const { rebalanceClaims } = await import("./liquidity");
  const { executePayout, spendableTzs } = await import("./payout");
  const { notify } = await import("./notify");

  /*
   * What the float can pay, shared across everybody waiting.
   *
   * Read once, before anything is sent, because it is one pool: deciding row
   * by row would let the first customer take all of it while the rule that
   * was meant to share it looked on.
   */
  const capacity = await payoutCapacityTzs();
  const outstanding = rows.map((r) => ({
    id: r.id, outstandingTzs: Number(r.amount_tzs) - Number(r.paid_tzs ?? 0),
  }));
  const owedTotal = outstanding.reduce((t, r) => t + r.outstandingTzs, 0);

  /* A null capacity means the float could not be read. Failing open here would
     pay everybody in full against a number nobody has; the queue simply
     waits. */
  if (capacity === null) return out;

  const plan = new Map(proRataSplit(outstanding, capacity).map((p) => [p.id, p.payTzs]));
  if (capacity < owedTotal) out.stillShort = rows.length - plan.size;

  for (const row of rows) {
    out.checked++;
    const payTzs = plan.get(row.id) ?? 0;
    const outstandingTzs = Number(row.amount_tzs) - Number(row.paid_tzs ?? 0);
    const amountTzs = payTzs;
    const dest: PayoutDest = row.destination?.bankCode
      ? { bankCode: row.destination.bankCode, accountNumber: row.destination.accountNumber }
      : { phoneNumber: row.destination?.phoneNumber ?? "" };
    const label = row.destination?.label
      ?? (dest.bankCode ? `${dest.bankCode} account` : dest.phoneNumber ?? "your account");

    /*
     * The balance is checked again, not assumed.
     *
     * Between queuing and now the customer may have bought shares with the
     * same shillings. Paying out against a balance that is no longer there
     * would turn a queued promise into an overdraft, so a row that can no
     * longer be funded from their own account is cancelled rather than sent.
     */
    const funds = await spendableTzs(row.user_id).catch(() => null);
    if (funds && outstandingTzs > funds.totalTzs + 1) {
      await sql`update capx.withdrawal_queue
                   set status = 'cancelled',
                       last_error = 'balance no longer covers it'
                 where id = ${row.id}::uuid`;
      continue;
    }

    /*
     * Nothing for this row this pass.
     *
     * Either the float is short and their share rounded below what is worth
     * sending, or there is nothing to send. Nothing is asked of a provider
     * here: their buying cannot raise the float — a DSE order moves no money
     * — so the only things that refill it are a deposit, a provider funding
     * their account, or inventory sold on the exchange.
     */
    if (!(payTzs > 0)) continue;

    const full = payTzs >= outstandingTzs - 1;

    try {
      /*
       * Keyed to the row and to what has already gone out, so a part payment
       * and the payment that finishes it are different writes — and a retry
       * of either after an uncertain response still cannot pay twice.
       */
      const result = await executePayout({
        userId: row.user_id, amountTzs: payTzs, dest, label,
        key: `queue:${row.id}:${Math.round(Number(row.paid_tzs ?? 0))}`,
      });

      await sql`update capx.withdrawal_queue
                   set paid_tzs = paid_tzs + ${payTzs},
                       status = ${full ? "sent" : "queued"},
                       sent_at = ${full ? sql`now()` : null},
                       last_error = null,
                       attempts = attempts + 1
                 where id = ${row.id}::uuid`;
      if (full) out.sent++; else out.partial++;

      /* The float has just fallen; put the claims back under it. */
      await rebalanceClaims().catch(() => null);

      await notify({
        userId: row.user_id, kind: "withdrawal", ref: `withdrawal:${result.ref}`,
        title: `${Math.round(payTzs).toLocaleString()} TZS sent`,
        body: full
          ? `The withdrawal you were waiting on is on its way to ${label}.`
          : `Part of your withdrawal is on its way to ${label}. `
            + `${Math.round(outstandingTzs - payTzs).toLocaleString()} TZS is still queued and `
            + `follows as soon as it can.`,
        url: "/activity",
      }).catch(() => {});
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 400);
      const attempts = row.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;

      await sql`update capx.withdrawal_queue
                   set attempts = ${attempts}, last_error = ${message},
                       status = ${giveUp ? "failed" : "queued"}
                 where id = ${row.id}::uuid`;

      if (giveUp) {
        out.failed++;
        /*
         * A person, not another retry.
         *
         * Twelve failures is no longer a float problem — it is a destination
         * the rails will not pay, and nothing this job does will change that.
         * The customer's balance is untouched either way; what they need is
         * somebody to tell them why.
         */
        const { sendMail } = await import("./mail");
        await sendMail({
          subject: "CAPX: a queued withdrawal has stopped retrying",
          text:
            `${Math.round(payTzs).toLocaleString()} TZS to ${label} has failed ` +
            `${attempts} times and will not be retried.\n\nLast error: ${message}\n\n` +
            `The customer's balance was refunded on each certain failure and is intact. ` +
            `This needs a person: either the destination is wrong or the rail is refusing it.`,
        }).catch(() => {});
      }
    }
  }

  return out;
}
