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
   * Once the fee account exists, it is the only account that pays.
   *
   * The obvious fallback — pay from the omnibus when the fee account is short
   * — is the one thing this separation exists to prevent. The money would be
   * genuinely theirs and genuinely in the omnibus, so nothing would be
   * *wrong*, but a broker withdrawal would be drawing on the shillings that
   * back customer balances, silently, at the moment nobody is watching. A
   * refusal is an inconvenience; that is a mixing of funds.
   *
   * So a withdrawal larger than what has been swept is refused and says what
   * is missing. The omnibus is used only while there is no fee account at
   * all, because then there is nothing to separate from.
   */
  const { brokerNtzsBalance, brokerAccountConfigured } = await import("./brokerAccount");
  const brokerAccount = brokerAccountConfigured ? await brokerNtzsBalance() : null;

  let payer: string;
  const fromBroker = !!brokerAccount?.walletAddress;
  if (fromBroker) {
    if (brokerAccount!.tzs < amountTzs) {
      throw new Error(
        `The fee account holds ${Math.floor(brokerAccount!.tzs).toLocaleString()} TZS. `
        + "The rest has been earned but not yet swept into it, so it cannot be withdrawn yet.",
      );
    }
    payer = brokerAccount!.id;
  } else {
    // No fee account yet: the fees are in the settlement account because
    // there is nowhere else for them to be. It has to be holding shillings
    // before it can send them, so this mints from the float if it is not.
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
