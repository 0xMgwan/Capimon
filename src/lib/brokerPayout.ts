import "server-only";
import { withdrawalQuote, createWithdrawal, ntzsConfigured, type PayoutDest } from "./ntzs";
import { omnibusUserId } from "./omnibus";
import type { PayoutDestination } from "./opsContacts";

/**
 * Paying the broker, for real.
 *
 * The same rail a customer withdrawal uses: shillings leave the settlement
 * account and arrive as mobile money or a bank transfer. Nothing about this
 * is special because the recipient is a counterparty rather than a customer —
 * it is the same omnibus, the same disbursement, the same failures.
 *
 * Deliberately the disbursement rail and not the ramp. The ramp pays from the
 * USDC float, which for money that is already shillings going to a shilling
 * account is a round trip through a currency nobody asked for, charged a
 * spread on both legs.
 *
 * Throws on anything that did not certainly succeed. The caller writes the
 * ledger row only after this returns, because a row claiming a payment that
 * never left is invisible, where a payment with no row shows up as a
 * difference anybody can see.
 */
export async function payBroker(
  amountTzs: number,
  dest: PayoutDestination,
): Promise<{ reference: string; label: string; from: "broker" | "omnibus" }> {
  if (!ntzsConfigured) throw new Error("nTZS is not configured, so nothing can be paid out.");

  const to: PayoutDest = dest.method === "bank"
    ? { bankCode: dest.bankCode!, accountNumber: dest.accountNumber! }
    : { phoneNumber: dest.phoneNumber! };

  const label = dest.method === "bank"
    ? `${dest.bankCode} account ending ${(dest.accountNumber ?? "").slice(-4)}`
    : `${dest.phoneNumber}`;

  /*
   * Paid from the broker's own account when their swept fees are sitting in
   * it, and from the omnibus when they are not.
   *
   * Which one holds the money depends on whether a sweep has run since the
   * fees were earned, and the answer is a balance we can read rather than an
   * assumption. Paying from an empty broker account would fail a withdrawal
   * of money that genuinely exists; always paying from the omnibus would
   * leave the broker account filling up with nothing to do.
   */
  const { brokerNtzsBalance } = await import("./brokerAccount");
  const brokerAccount = await brokerNtzsBalance();
  const fromBroker = !!brokerAccount && brokerAccount.tzs >= amountTzs;

  let payer: string;
  if (fromBroker) {
    payer = brokerAccount!.id;
  } else {
    // The settlement account has to be holding shillings before it can send
    // them; this mints from the float if it is not.
    const { ensureNtzsHasTzs } = await import("./ntzsFunding");
    await ensureNtzsHasTzs(amountTzs);
    payer = await omnibusUserId();
  }

  const quote = await withdrawalQuote({ userId: payer, amountTzs, ...to });
  const quoteId = String(quote.quoteId ?? quote.id ?? "");
  if (!quoteId) throw new Error("Could not price the payout.");

  const result = await createWithdrawal({ userId: payer, quoteId, amountTzs, ...to });
  const reference = String(
    (result as Record<string, unknown>).reference
    ?? (result as Record<string, unknown>).id
    ?? quoteId,
  );

  return { reference, label, from: fromBroker ? "broker" : "omnibus" as const };
}
