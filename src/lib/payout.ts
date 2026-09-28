import "server-only";
import { type PayoutDest, withdrawalQuote, createWithdrawal, NtzsError,
         rampQuote, rampOfframp, getSwapRate } from "./ntzs";
import { balanceOf, record } from "./ledger";
import { omnibusUserId, capabilities } from "./omnibus";

/**
 * Sending shillings to a person, wherever the instruction came from.
 *
 * This used to live inside the withdrawal route, which was fine while a
 * request was the only thing that could pay somebody. A queued payout is
 * retried by the scheduler with no request in sight, and the one thing that
 * must not be reimplemented for it is this: the debit-before-payout ordering,
 * the refund-only-when-certain rule, and the idempotency key that stops a
 * retry debiting twice. Two copies of that would eventually disagree, and the
 * way they would disagree is by paying somebody twice.
 */

/**
 * What the account can actually withdraw, in shillings.
 *
 * A deposit settles as TZS on the wallet routes and as USDC on the ramp, so an
 * account may hold either. Checking TZS alone told a fully funded ramp customer
 * their balance was zero.
 */
export async function spendableTzs(userId: string) {
  const [tzs, usdc] = await Promise.all([
    balanceOf(userId, "TZS"),
    balanceOf(userId, "USDC"),
  ]);
  if (usdc <= 0) return { tzs, usdc, totalTzs: tzs, usdcPerTzs: null as number | null };

  // Value the USDC leg at the live shilling rate; without one, only the TZS
  // balance is offered rather than guessing at a conversion.
  let usdcPerTzs: number | null = null;
  try {
    const r = await getSwapRate("NTZS", "USDC", 100_000);
    const out = Number(r.expectedOutput ?? 0);
    if (out > 0) usdcPerTzs = out / 100_000;
  } catch { /* fall back to shillings only */ }

  const totalTzs = tzs + (usdcPerTzs ? usdc / usdcPerTzs : 0);
  return { tzs, usdc, totalTzs, usdcPerTzs };
}

/**
 * Which rail pays this out.
 *
 * Shillings first, whenever the omnibus is holding enough of them.
 *
 * The ramp pays from the USDC float, so using it means sending dollars to the
 * float and having them converted back into shillings at the other end. For
 * someone who sold a shilling-priced share, holds shillings, and is being paid
 * in shillings, that is a round trip through a currency nobody involved asked
 * for — and it is charged a spread on both legs.
 *
 * The ramp used to be preferred unconditionally because the disbursement rail
 * refuses to quote more than the omnibus is holding. That is a real limit, but
 * it is a balance that can be read rather than a reason to avoid the rail
 * entirely. So: disburse when the shillings are already there, and fall back to
 * the ramp when they are not.
 */
export async function chooseRail(amountTzs: number, rampAvailable: boolean) {
  if (!rampAvailable) return false;
  try {
    const { omnibusBalances } = await import("./omnibus");
    const { getSwapRate } = await import("./ntzs");
    const omnibus = await omnibusBalances();

    /*
     * Count the dollars the disbursement rail can convert, not only the
     * shillings already sitting there.
     *
     * This asked whether the omnibus held enough TZS and nothing else, so an
     * omnibus of 84,139 TZS and 3.79 USDC sent a 90,000 TZS payout to the
     * ramp — which then converted ninety thousand shillings into dollars,
     * pushed them into the settlement float, and off-ramped them back into
     * shillings on the customer's phone. Two spreads and a payout fee, to
     * raise a shortfall of 5,861 that one small swap covered.
     *
     * ensureNtzsHasTzs converts exactly that way for this rail, and will pull
     * from the treasury when the omnibus is short of dollars, so the honest
     * question is what all three together can reach.
     */
    const probe = 100_000;
    const rate = await getSwapRate("NTZS", "USDC", probe)
      .then((r) => Number(r.expectedOutput ?? 0) / probe)
      .catch(() => 0);

    let reachableTzs = omnibus.tzs;
    if (rate > 0) {
      const { treasuryHoldings } = await import("./treasury");
      const treasuryUsdc = await treasuryHoldings()
        .then((h) => Number(h?.usdc ?? 0)).catch(() => 0);
      // Discounted by the same margin the conversion itself adds for spread.
      reachableTzs += ((omnibus.usdc + treasuryUsdc) / rate) / 1.02;
    }

    // A small margin, so a payout is not routed to a balance that a concurrent
    // trade is about to spend.
    if (reachableTzs >= amountTzs * 1.02) return false;
  } catch {
    /* cannot read the omnibus: the ramp can always fund itself */
  }
  return true;
}

export type PayoutRequest = {
  userId: string;
  amountTzs: number;
  dest: PayoutDest;
  /** How the destination is described back to the customer. */
  label: string;
  /**
   * The idempotency key. Every ledger entry this writes is derived from it, so
   * the same key can be retried after an uncertain outcome without debiting
   * anybody twice. A request passes its quote id; the queue passes its row id.
   */
  key: string;
};

/**
 * Debits the customer, pays the rail, and refunds only if the payout certainly
 * did not happen.
 *
 * Paying first and recording after leaves one ordering where money reaches the
 * customer and the ledger never learns of it — which is exactly what happened:
 * an off-ramp settled, the bookkeeping after it threw, and the balance went on
 * claiming funds that had already left. A debit that gets reversed is
 * recoverable; money out with no debit is not.
 *
 * Throws on failure, carrying the rail's own error where there is one, because
 * the caller needs to distinguish "did not happen" from "may have happened".
 */
export async function executePayout(req: PayoutRequest): Promise<{ ref: string; status: string }> {
  const { userId, amountTzs, dest, label, key } = req;
  const phoneNumber = dest.phoneNumber ?? "";

  const funds = await spendableTzs(userId);
  const caps = await capabilities();
  const viaRamp = dest.bankCode ? false : await chooseRail(amountTzs, caps.ramp.available);

  const fromTzs = Math.min(funds.tzs, amountTzs);
  const remainderTzs = amountTzs - fromTzs;
  const fromUsdc = remainderTzs > 0 && funds.usdcPerTzs ? remainderTzs * funds.usdcPerTzs : 0;
  const rail = viaRamp ? "ramp" : "disbursement";

  await record([
    ...(fromTzs > 0
      ? [{ userId, kind: "withdrawal" as const, asset: "TZS", amount: (-fromTzs).toString(),
           ref: `withdrawal:${key}`, metadata: { destination: label, ...dest, quoteId: key, rail } }]
      : []),
    ...(fromUsdc > 0
      ? [{ userId, kind: "withdrawal" as const, asset: "USDC", amount: (-fromUsdc).toString(),
           ref: `withdrawal:${key}:usdc`, metadata: { destination: label, ...dest, quoteId: key, amountTzs: remainderTzs } }]
      : []),
  ]);

  let result: { id?: string; status?: string };
  try {
    /*
     * Fund first, quote second, spend immediately.
     *
     * A ramp quote is locked for about a minute. Funding the float is a chain
     * transfer that takes seconds to tens of seconds, and it used to run
     * between the quote being priced and the payout being requested — so the
     * quote the customer had read was routinely dead by the time it was
     * spent, and the payout came back "expired, already used, or not an
     * off-ramp quote". The quote shown in the panel is indicative; the one
     * that actually pays is fetched here, moments before it is used.
     *
     * The caller's key still keys the ledger entries, so a retry after an
     * uncertain response cannot debit the same person twice.
     */
    if (viaRamp) {
      const { fundRampFloat } = await import("./ntzsFunding");
      await fundRampFloat(amountTzs, phoneNumber);

      const fresh = await rampQuote({ direction: "offramp", amount: amountTzs, phoneNumber });
      const freshId = String(fresh.quoteId ?? fresh.id ?? fresh.quote_id ?? fresh.reference ?? "");
      if (!freshId) throw new NtzsError("quote_unavailable", "Could not price the payout just before sending it.", 502);

      result = await rampOfframp({ quoteId: freshId, phoneNumber });
    } else {
      const { ensureNtzsHasTzs } = await import("./ntzsFunding");
      await ensureNtzsHasTzs(amountTzs);

      const omnibus = await omnibusUserId();
      const fresh = await withdrawalQuote({ userId: omnibus, amountTzs, ...dest });
      const freshId = fresh.quoteId ?? key;

      result = await createWithdrawal({ userId: omnibus, quoteId: freshId, amountTzs, ...dest });
    }
  } catch (payoutError) {
    /*
     * Refund only when the payout certainly did not happen. An uncertain
     * outcome — a timeout, a 5xx — may still have moved money, so the debit
     * stands and the row is left for reconciliation rather than handing back
     * funds that already left.
     */
    const err = payoutError instanceof NtzsError ? payoutError : null;
    const uncertain = err?.retry === "verify";
    if (!uncertain) {
      await record([
        ...(fromTzs > 0
          ? [{ userId, kind: "adjustment" as const, asset: "TZS", amount: fromTzs.toString(),
               ref: `withdrawal:${key}:refund`, metadata: { quoteId: key, reason: "payout did not execute" } }]
          : []),
        ...(fromUsdc > 0
          ? [{ userId, kind: "adjustment" as const, asset: "USDC", amount: fromUsdc.toString(),
               ref: `withdrawal:${key}:refund-usdc`, metadata: { quoteId: key, reason: "payout did not execute" } }]
          : []),
      ]).catch(() => null);
    }
    throw payoutError;
  }

  return { ref: String(result.id ?? key), status: String(result.status ?? "submitted") };
}
