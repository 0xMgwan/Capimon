import type { StableToken } from "./stablecoinDeposits";

/**
 * Crediting a small deposit before its block is safe.
 *
 * The finality gate exists because a transfer mined on Base can still be
 * reorged out, and a balance credited from a transaction that disappears is
 * money CAPX gave away. That reasoning does not change here. What changes is
 * that it is weighed against something, instead of being treated as the only
 * consideration at every size.
 *
 * The wait is one to three minutes, sawtoothing as each batch reaches
 * Ethereum. For a customer topping up twenty dollars to buy a share, that
 * wait costs more in abandonment than the reorg it insures against costs in
 * expectation. For a large deposit it does not, and the arithmetic flips
 * entirely: the same reorg takes a hundred times as much.
 *
 * So the rule is proportional. Below a ceiling the deposit is credited the
 * moment it is mined; above it, nothing changes. And because ten small
 * deposits are not a small deposit, there is a second ceiling on how much
 * early credit may be outstanding at once.
 *
 * ## What this is not
 *
 * It is not trust in the caller. The transfer is still read from the chain by
 * its own hash, the recipient must still be the omnibus, and the amount is
 * still what the Transfer log carries. The money is genuinely in the omnibus
 * before any of this runs — the only thing skipped is waiting for the batch
 * carrying it to reach Ethereum.
 *
 * It is also not irreversible. An early credit stays tracked until its block
 * goes safe, and a transaction that vanishes before then is reversed out of
 * the ledger rather than quietly left. If the customer spent it first, the
 * reversal takes their balance negative, which is the honest record of what
 * happened and the thing the desk is told about. The ceilings exist so that
 * number is small enough to absorb.
 *
 * ## Per token, not per dollar
 *
 * The ceilings are denominated in the token itself rather than converted to a
 * common currency. A conversion in this path would put a rate lookup between
 * a customer and their money and give a stale or unavailable rate a say in
 * whether a deposit is credited. Two numbers that need no network call are
 * worth more here than one that reads well.
 */

/** Per-deposit ceilings. Zero disables early credit for that token entirely. */
export const INSTANT_CAP: Record<StableToken, number> = {
  USDC: Math.max(0, Number(process.env.INSTANT_CREDIT_USDC ?? 25) || 0),
  NTZS: Math.max(0, Number(process.env.INSTANT_CREDIT_TZS ?? 60_000) || 0),
};

/**
 * How many ceilings may be outstanding at once.
 *
 * The exposure that matters is the sum of everything credited early and not
 * yet safe, not the size of any one of them. Four is a deliberate small
 * multiple: enough that a handful of customers topping up in the same minute
 * all get the fast path, small enough that the worst case is a number the
 * desk can absorb without a conversation.
 */
export const INSTANT_EXPOSURE_MULTIPLE =
  Math.max(1, Number(process.env.INSTANT_CREDIT_EXPOSURE ?? 4) || 4);

export const instantExposureCap = (token: StableToken) =>
  INSTANT_CAP[token] * INSTANT_EXPOSURE_MULTIPLE;

export type InstantVerdict =
  | { instant: true }
  | { instant: false; reason: string };

/**
 * Whether this deposit may be credited before its block is safe.
 *
 * Pure, and every refusal says which ceiling stopped it — an operator asking
 * "why did that one wait" should not have to reconstruct the arithmetic.
 */
export function instantAllowed(input: {
  token: StableToken;
  amount: number;
  /** Already credited early and not yet safe, in the same token. */
  outstanding: number;
}): InstantVerdict {
  const cap = INSTANT_CAP[input.token];
  if (!(cap > 0)) return { instant: false, reason: "early credit is off for this token" };
  if (!(input.amount > 0)) return { instant: false, reason: "no amount" };

  if (input.amount > cap) {
    return { instant: false,
      reason: `${input.amount} is over the ${cap} ${input.token} ceiling for an early credit` };
  }

  const exposure = instantExposureCap(input.token);
  if (input.outstanding + input.amount > exposure) {
    return { instant: false,
      reason: `${(input.outstanding + input.amount).toFixed(2)} ${input.token} would be credited `
            + `early and unsettled, over the ${exposure} ceiling` };
  }

  return { instant: true };
}
