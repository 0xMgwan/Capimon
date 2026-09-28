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

type Row = {
  id: string; user_id: string; amount_tzs: string;
  destination: PayoutDest & { label?: string }; attempts: number;
};

export async function reconcileQueue(): Promise<{
  checked: number; sent: number; stillShort: number; failed: number;
}> {
  const out = { checked: 0, sent: 0, stillShort: 0, failed: 0 };
  if (!dbConfigured) return out;
  await migrate();
  const sql = db();

  const rows = await sql<Row[]>`
    select id::text, user_id::text, amount_tzs::text, destination, attempts
      from capx.withdrawal_queue
     where status = 'queued'
     order by created_at
     limit 20`;
  if (!rows.length) return out;

  const { payoutCapacityTzs } = await import("./ntzsFunding");
  const { rebalanceClaims } = await import("./liquidity");
  const { executePayout, spendableTzs } = await import("./payout");
  const { notify } = await import("./notify");

  for (const row of rows) {
    out.checked++;
    const amountTzs = Number(row.amount_tzs);
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
    if (funds && amountTzs > funds.totalTzs + 1) {
      await sql`update capx.withdrawal_queue
                   set status = 'cancelled',
                       last_error = 'balance no longer covers it'
                 where id = ${row.id}::uuid`;
      continue;
    }

    /*
     * Enough shillings yet?
     *
     * Nothing is asked of a provider here. Their buying cannot raise the
     * float — a DSE order moves no money — so the only things that refill it
     * are a deposit, a provider funding their account, or inventory sold on
     * the exchange. This waits for one of those.
     */
    const capacity = await payoutCapacityTzs();
    if (capacity !== null && amountTzs > capacity) {
      out.stillShort++;
      /*
       * Stop at the first one that cannot be funded.
       *
       * Skipping ahead to a smaller row would pay a later customer before an
       * earlier one out of the same short float, which is exactly the thing a
       * queue exists to prevent.
       */
      break;
    }

    try {
      /* The row id is the idempotency key, so a retry after an uncertain
         response cannot debit the same person twice. */
      const result = await executePayout({
        userId: row.user_id, amountTzs, dest, label, key: `queue:${row.id}`,
      });

      await sql`update capx.withdrawal_queue
                   set status = 'sent', sent_at = now(), last_error = null,
                       attempts = attempts + 1
                 where id = ${row.id}::uuid`;
      out.sent++;

      /* The float has just fallen; put the claims back under it. */
      await rebalanceClaims().catch(() => null);

      await notify({
        userId: row.user_id, kind: "withdrawal", ref: `withdrawal:${result.ref}`,
        title: `${Math.round(amountTzs).toLocaleString()} TZS sent`,
        body: `The withdrawal you were waiting on is on its way to ${label}.`,
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
            `${Math.round(amountTzs).toLocaleString()} TZS to ${label} has failed ` +
            `${attempts} times and will not be retried.\n\nLast error: ${message}\n\n` +
            `The customer's balance was refunded on each certain failure and is intact. ` +
            `This needs a person: either the destination is wrong or the rail is refusing it.`,
        }).catch(() => {});
      }
    }
  }

  return out;
}
