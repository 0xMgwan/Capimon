import "server-only";
import { db, migrate } from "./db";
import { FEE_SWEEP_ADDRESS, feeSweepConfigured, FEE_SWEEP_MIN_TZS } from "./fees";

/**
 * Moving trade fees out of the customer float.
 *
 * Fees are charged inside a trade and simply stay where the trade left them —
 * in the omnibus, alongside money that belongs to customers. That is safe, but
 * it makes one balance mean two things, and "what has the business earned" then
 * has no answer that does not involve recomputing it.
 *
 * Sweeping keeps the money in shillings. Converting it to dollars to sweep
 * would take an exchange-rate position on revenue that is earned, held and
 * spent in shillings.
 */

export type FeeSweep = {
  id: string;
  amount_tzs: number;
  destination: string;
  status: "pending" | "settled" | "uncertain" | "failed";
  transfer_id: string | null;
  tx_hash: string | null;
  error: string | null;
  created_at: string;
  settled_at: string | null;
};

/** Everything ever charged, from the entries that charged it. */
export async function feesCharged(): Promise<number> {
  await migrate();
  const rows = await db()<{ total: string | null }[]>`
    select coalesce(sum((metadata->>'fee')::numeric), 0)::text as total
      from capx.ledger_entries
     where asset = 'TZS' and metadata ? 'fee'`;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Everything already moved out, or possibly moved out.
 *
 * Pending and uncertain both count as taken, which is the whole point. A
 * transfer whose outcome we do not know may well have landed, and the failure
 * that tells us least — a timeout, a connection dropped after the request went
 * out — is exactly the one where the money is most likely already gone.
 * Counting those as unswept would let the next sweep send them a second time,
 * and an over-sweep comes out of customer float.
 *
 * Only a sweep known not to have been sent is excluded, and releasing one into
 * that state is a deliberate act.
 */
export async function feesSwept(): Promise<number> {
  await migrate();
  const rows = await db()<{ total: string | null }[]>`
    select coalesce(sum(amount_tzs), 0)::text as total
      from capx.fee_sweeps where status in ('pending', 'settled', 'uncertain')`;
  return Number(rows[0]?.total ?? 0);
}

export type FeePosition = {
  charged: number;
  swept: number;
  unswept: number;
  destination: string | null;
  minimum: number;
  /** Whether a sweep would run right now, and why not when it would not. */
  sweepable: boolean;
  reason: string | null;
};

export async function feePosition(): Promise<FeePosition> {
  const [charged, swept] = await Promise.all([feesCharged(), feesSwept()]);
  const unswept = Math.round((charged - swept) * 100) / 100;

  let reason: string | null = null;
  if (!feeSweepConfigured) reason = "No sweep destination is configured (FEE_SWEEP_ADDRESS).";
  else if (unswept <= 0) reason = "Nothing to sweep.";
  else if (unswept < FEE_SWEEP_MIN_TZS) {
    reason = `${unswept.toLocaleString()} TZS accrued; sweeping starts at ${FEE_SWEEP_MIN_TZS.toLocaleString()}.`;
  }

  return {
    charged, swept, unswept,
    destination: feeSweepConfigured ? FEE_SWEEP_ADDRESS : null,
    minimum: FEE_SWEEP_MIN_TZS,
    sweepable: reason === null,
    reason,
  };
}

export async function recentSweeps(limit = 20): Promise<FeeSweep[]> {
  await migrate();
  const rows = await db()<(Omit<FeeSweep, "amount_tzs"> & { amount_tzs: string })[]>`
    select id::text, amount_tzs::text, destination, status, transfer_id, tx_hash,
           error, created_at, settled_at
      from capx.fee_sweeps order by id desc limit ${limit}`;
  return rows.map((r) => ({ ...r, amount_tzs: Number(r.amount_tzs) }));
}

/**
 * Sweeps everything accrued so far.
 *
 * The row is written before the transfer is attempted. If the process dies
 * between the two, what is left is a pending sweep to reconcile — which is
 * recoverable — rather than shillings that moved with no record, which is not.
 * For the same reason a failure marks the row rather than deleting it.
 *
 * `force` exists for the minimum only. It cannot override a missing
 * destination, because there is nowhere for the money to go.
 */
export async function sweepFees(opts: { force?: boolean; actor?: string } = {}) {
  const position = await feePosition();
  if (!feeSweepConfigured) throw new Error(position.reason ?? "No sweep destination is configured.");
  if (position.unswept <= 0) throw new Error("Nothing to sweep.");
  if (!position.sweepable && !opts.force) throw new Error(position.reason ?? "Not sweepable.");

  const amount = position.unswept;
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into capx.fee_sweeps (amount_tzs, destination, status)
    values (${amount}, ${FEE_SWEEP_ADDRESS}, 'pending')
    returning id::text`;
  const id = rows[0].id;

  try {
    const { omnibusUserId } = await import("./omnibus");
    const { transferNtzs } = await import("./ntzs");
    const res = await transferNtzs({
      fromUserId: await omnibusUserId(),
      toAddress: FEE_SWEEP_ADDRESS,
      amountTzs: amount,
      purpose: "fee_sweep",
      // Ties the retry to this row, so a repeat is the same transfer.
      reference: `capx-fee-sweep-${id}`,
    });

    await sql`
      update capx.fee_sweeps
         set status = 'settled', transfer_id = ${res.id ?? null},
             tx_hash = ${res.txHash ?? null}, settled_at = now()
       where id = ${id}::bigint`;

    return { ok: true as const, id, amount, txHash: res.txHash ?? null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "transfer failed";
    /*
     * Rejected, or merely unanswered?
     *
     * A 4xx is the API saying it will not do this — nothing moved. Anything
     * else, a timeout above all, leaves the transfer's fate unknown, and the
     * money is more likely gone than not. Those are held as uncertain and keep
     * counting as swept, so the next run cannot send them again; releasing one
     * is a decision someone takes after checking, not a default.
     */
    const rejected = /\b4\d\d\b/.test(message);
    await sql`
      update capx.fee_sweeps
         set status = ${rejected ? "failed" : "uncertain"}, error = ${message.slice(0, 500)}
       where id = ${id}::bigint`;

    throw new Error(
      rejected
        ? `Sweep of ${amount.toLocaleString()} TZS was refused and nothing was sent — ${message}`
        : `Sweep of ${amount.toLocaleString()} TZS did not confirm — ${message}. ` +
          `It is held as uncertain and still counts as swept, so it will not be sent twice. ` +
          `Check the transfer at nTZS before releasing it.`,
    );
  }
}
