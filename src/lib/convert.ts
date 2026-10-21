import "server-only";
import { randomUUID } from "crypto";
import { balanceOf, record } from "./ledger";

/**
 * Turning a dollar balance back into shillings.
 *
 * This exists because of a one-way door. A shilling buy converts to USDC and
 * then trades; when the trade fails, the customer's money is correctly
 * recorded as USDC — and until that is reversible, somebody whose balance was
 * shillings and whose intention was CRDB is left holding a currency they never
 * asked for.
 *
 * It matters twice over for partners. The Dar es Salaam board prices and
 * settles in shillings and reads a shilling balance, so a customer holding
 * only dollars cannot buy CRDB at all until this has run. Exposing it to
 * partners is what makes "my customer has USDC" a complete answer rather than
 * half of one.
 *
 * One direction only. Shillings become dollars when somebody buys a US share,
 * which is the moment that conversion is for; doing it at any other time would
 * be a currency desk, and CAPX is not one.
 */

export const MIN_USDC = 0.01;

export type Converted =
  | { ok: true; usdc: number; tzs: number }
  | { ok: false; code: string; error: string; status: number };

export async function convertUsdcToTzs(
  userId: string, input: { amountUsdc?: number; all?: boolean },
): Promise<Converted> {
  const held = await balanceOf(userId, "USDC");

  /*
   * "All of it" is the case this is really for, and asking somebody to type
   * 0.82 to clear a balance of 0.82 invites them to leave dust behind by
   * mistyping it.
   */
  const amount = input.all === true ? held : Number(input.amountUsdc);
  if (!Number.isFinite(amount) || amount < MIN_USDC) {
    return { ok: false, code: "bad_amount",
      error: `The smallest amount to convert is $${MIN_USDC.toFixed(2)}.`, status: 400 };
  }
  if (amount > held + 1e-9) {
    return { ok: false, code: "insufficient_balance",
      error: `That account holds $${held.toFixed(2)}.`, status: 409 };
  }

  // Rounded to the ledger's own precision, so the debit cannot exceed what
  // the swap was asked for.
  const usdc = Math.floor(amount * 1e6) / 1e6;

  const { swapUsdcToTzs } = await import("./ntzsFunding");
  const converted = await swapUsdcToTzs(usdc);

  /*
   * Both legs or neither, keyed to one reference.
   *
   * `record` is transactional, so a debit cannot land without its credit —
   * which in a currency conversion is the only property that matters.
   *
   * The figure credited is what the swap reported, never a balance reading:
   * the omnibus is shared, and differencing it credits one customer for
   * another's movement.
   */
  const ref = `convert:${randomUUID()}`;
  await record([
    { userId, kind: "adjustment", asset: "USDC", amount: (-converted.usdcSpent).toString(),
      ref: `${ref}:usdc`,
      metadata: { reason: "converted to shillings", tzs: converted.tzs } },
    { userId, kind: "adjustment", asset: "TZS", amount: converted.tzs.toString(),
      ref: `${ref}:tzs`,
      metadata: { reason: "converted from dollars", usdc: converted.usdcSpent } },
  ]);

  return { ok: true, usdc: converted.usdcSpent, tzs: converted.tzs };
}
