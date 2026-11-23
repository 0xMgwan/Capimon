import "server-only";
import { isAddress, getAddress, formatUnits, parseUnits } from "viem";
import { publicClient } from "./chain";
import { USDC_BASE } from "./assets";
import { b20Abi } from "./abis";
import { balanceOf, record } from "./ledger";
import { signer, treasuryAddress, ensureTreasuryFunded } from "./treasury";

/**
 * Paying a dollar balance out to a wallet instead of to a phone.
 *
 * Every withdrawal CAPX had went to mobile money or a bank, priced in
 * shillings, because that is how somebody in Dar takes money out. A partner's
 * customer who deposited USDC and wants USDC back had no way to get it: the
 * only exits converted to shillings and paid a Tanzanian rail, which for
 * somebody who never wanted shillings is a round trip through two spreads to
 * end up somewhere they cannot use.
 *
 * So this is the dollar exit. The treasury signs an ordinary USDC transfer on
 * Base to an address the customer names. No conversion, no rail, no fee of
 * ours.
 *
 * ## The order of operations is the whole design
 *
 * Debit the ledger, then send. Not the other way round, and the reason is
 * which failure you would rather have:
 *
 *   Debit first — a crash between the two leaves the customer short and the
 *   money still in custody. Solvency shows a surplus, the desk can see it,
 *   and it is repairable by giving the balance back.
 *
 *   Send first — a crash leaves the money gone and the balance intact, so the
 *   customer can spend it again. That is not repairable; it is a double
 *   spend with a transaction hash attached.
 *
 * ## And a refund is only safe when nothing moved
 *
 * Once a transaction is broadcast it may confirm whatever we observe next, so
 * a timeout waiting for a receipt is *not* permission to hand the balance
 * back — doing that pays the customer twice. The refund therefore happens
 * only on failures that provably precede broadcast, and anything after it is
 * left debited with the hash recorded for a person to settle. `payout.ts`
 * draws the same line for the same reason.
 */

/** Below this the network fee and the bookkeeping cost more than it moves. */
export const MIN_WITHDRAWAL_USDC = 1;

export type UsdcWithdrawalResult =
  | { ok: true; txHash: `0x${string}`; amount: number; to: `0x${string}`; explorer: string }
  | { ok: false; code: string; error: string; status: number };

const refuse = (code: string, error: string, status = 400): UsdcWithdrawalResult =>
  ({ ok: false, code, error, status });

/**
 * Checks an address the way a person pasting one needs it checked.
 *
 * Checksummed on the way out so what is echoed back is canonical, and the two
 * addresses that are always a mistake are refused by name: the zero address
 * burns the money, and CAPX's own treasury would credit nobody while leaving
 * the customer debited.
 */
export function parseDestination(raw: string): { ok: true; address: `0x${string}` }
  | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: false, error: "A destination address is required." };
  if (!isAddress(v)) {
    return { ok: false, error: "That is not a valid address. It should be 42 characters starting 0x." };
  }
  const address = getAddress(v);
  if (/^0x0+$/i.test(address)) {
    return { ok: false, error: "That is the zero address — anything sent there is destroyed." };
  }
  const treasury = treasuryAddress();
  if (treasury && address.toLowerCase() === treasury.toLowerCase()) {
    return { ok: false, error: "That is CAPX's own treasury. Send to the customer's wallet." };
  }
  return { ok: true, address };
}

/**
 * Sends part of a customer's dollar balance to an address on Base.
 *
 * `key` makes the whole thing idempotent: the ledger refs are derived from it
 * and the unique index on `ref` means a retry after an uncertain response
 * debits nobody twice. Callers should derive it from something stable about
 * the request rather than from the clock.
 */
export async function withdrawUsdcToWallet(input: {
  userId: string;
  amount: number;
  to: string;
  key: string;
  /** Recorded on the ledger entry so the desk can see who asked. */
  via?: string;
}): Promise<UsdcWithdrawalResult> {
  const dest = parseDestination(input.to);
  if (!dest.ok) return refuse("bad_destination", dest.error);

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return refuse("bad_amount", "The amount must be a positive number of USDC.");
  }
  if (amount < MIN_WITHDRAWAL_USDC) {
    return refuse("below_minimum",
      `The smallest wallet withdrawal is ${MIN_WITHDRAWAL_USDC} USDC.`);
  }

  /*
   * Rounded to the token's own precision before anything is checked against
   * it, so the figure the balance is tested against is the figure that gets
   * sent. Six decimals of USDC and a float that says 10.0000004 otherwise
   * disagree about whether the balance covers it.
   */
  const usdc = Math.floor(amount * 1e6) / 1e6;

  const held = await balanceOf(input.userId, "USDC").catch(() => null);
  if (held === null) {
    return refuse("balance_unreadable",
      "The customer's balance could not be read just now. Nothing was sent; try again.", 503);
  }
  if (usdc > held + 1e-9) {
    return refuse("insufficient_balance",
      `That customer holds ${held.toFixed(6)} USDC.`, 409);
  }

  const treasury = treasuryAddress();
  if (!treasury) return refuse("not_configured", "No treasury is configured.", 503);

  /*
   * Debited before a transaction exists, so the worst case is a customer
   * owed money CAPX still holds rather than money CAPX no longer holds and
   * the customer can spend again.
   */
  const ref = `usdc-withdrawal:${input.key}`;
  const debit = await record([{
    userId: input.userId, kind: "withdrawal", asset: "USDC", amount: (-usdc).toString(),
    ref,
    metadata: { destination: dest.address, chain: "base", ...(input.via ? { via: input.via } : {}) },
  }]);

  /*
   * A duplicate key means this exact withdrawal was already accepted. Saying
   * "sent" without a hash would be a guess, so the caller is told plainly
   * that it is a repeat and pointed at the activity record.
   */
  if (debit.duplicate) {
    return refuse("already_submitted",
      "A withdrawal with this key was already accepted. Check the customer's activity for it "
      + "rather than sending a second one.", 409);
  }

  let broadcast = false;
  try {
    /* The dollars may be earning, or sitting at nTZS; this is the one place
       that knows how to get them back onto the treasury. */
    await ensureTreasuryFunded(usdc, treasury);

    const { account, wallet } = signer();
    const value = parseUnits(usdc.toFixed(6), 6);

    const balance = (await publicClient.readContract({
      address: USDC_BASE, abi: b20Abi, functionName: "balanceOf", args: [account.address],
    })) as bigint;
    if (balance < value) {
      throw new Error(
        `The treasury holds ${Number(formatUnits(balance, 6)).toFixed(2)} USDC and this needs `
        + `${usdc.toFixed(2)}. Nothing was sent.`);
    }

    const hash = await wallet.writeContract({
      address: USDC_BASE, abi: b20Abi, functionName: "transfer", args: [dest.address, value],
    });
    /* From here a refund would pay twice: the transaction is public and may
       confirm whatever happens to this process. */
    broadcast = true;

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      /*
       * A reverted transfer moved nothing — the chain says so, which is the
       * one post-broadcast outcome certain enough to refund.
       */
      await refund(input.userId, usdc, input.key, "the transfer reverted onchain");
      return refuse("transfer_reverted",
        "The transfer reverted onchain and the balance has been returned.", 502);
    }

    /*
     * The hash goes onto the withdrawal itself, not a second entry.
     *
     * A zero-amount row carrying the hash would have been simpler to write
     * and would have shown the customer a "0 USDC" line in their activity
     * next to the real one. The debit is the event; the hash is a fact about
     * it, so it belongs in that row's metadata — which is only knowable
     * after the send, hence the update rather than a richer insert.
     */
    const { db } = await import("./db");
    await db()`
      update capx.ledger_entries
         set metadata = metadata || ${JSON.stringify({ txHash: hash })}::jsonb
       where ref = ${ref}`.catch(() => null);

    return {
      ok: true, txHash: hash, amount: usdc, to: dest.address,
      explorer: `https://basescan.org/tx/${hash}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "The withdrawal did not go through.";
    if (!broadcast) {
      await refund(input.userId, usdc, input.key, message);
      return refuse("withdrawal_failed",
        `${message} Nothing was sent and the balance is unchanged.`, 502);
    }
    /*
     * Broadcast, then lost sight of. The money may well arrive, so the debit
     * stands and somebody is told rather than the balance being handed back
     * on a guess.
     */
    await alertStranded(input.userId, usdc, dest.address, input.key, message);
    return refuse("withdrawal_uncertain",
      "The transfer was broadcast but its outcome could not be confirmed. The balance stays "
      + "debited and CAPX is checking it — do not retry, as that would send twice.", 502);
  }
}

async function refund(userId: string, usdc: number, key: string, reason: string) {
  await record([{
    userId, kind: "adjustment", asset: "USDC", amount: usdc.toString(),
    ref: `usdc-withdrawal:${key}:refund`,
    metadata: { reason },
  }]).catch(() => null);
}

/**
 * Names the asset rather than assuming dollars.
 *
 * This said "USDC" unconditionally, which on a shilling withdrawal would have
 * put "25000 USDC" in front of whoever had to settle it — off by three orders
 * of magnitude and in the wrong currency, in the one message whose entire job
 * is to be acted on correctly.
 */
async function alertStranded(
  userId: string, amount: number, to: string, key: string, reason: string,
  asset: "USDC" | "TZS" = "USDC",
) {
  const { sendMail } = await import("./mail");
  const pretty = asset === "TZS"
    ? `${Math.round(amount).toLocaleString()} TZS (as nTZS)`
    : `${amount} USDC`;
  const where = asset === "TZS"
    ? "Check the omnibus wallet's recent transfers and the nTZS transfers log"
    : "Check the treasury's recent transactions on Basescan";
  await sendMail({
    subject: "CAPX: a wallet withdrawal was sent but not confirmed",
    text: `User ${userId} withdrew ${pretty} to ${to} (key ${key}).\n\n`
        + `It was submitted and the outcome could not be read: ${reason}\n\n`
        + `The balance stays debited because refunding something that may have moved pays `
        + `twice. ${where}: if it went, nothing more is needed; if it never landed, refund `
        + `the balance by hand.`,
  }).catch(() => null);
}

/* ------------------------------------------------------- shillings out -- */

/** Below this the transfer is not worth the bookkeeping either side of it. */
export const MIN_WITHDRAWAL_TZS = 1_000;

export type NtzsWithdrawalResult =
  | { ok: true; amountTzs: number; to: `0x${string}`; txHash: string | null; reference: string }
  | { ok: false; code: string; error: string; status: number };

/**
 * Sends a shilling balance to a wallet as nTZS, rather than to a phone.
 *
 * The mirror of the dollar exit, and the one a NEDApay customer actually
 * wants after selling a Dar es Salaam share: they hold nTZS everywhere else
 * in their life, so paying them out through a mobile money rail converts a
 * balance they already understand into one more rail, one more fee and a
 * reconciliation nobody asked for.
 *
 * ## Why this cannot be signed the way USDC is
 *
 * The treasury is an ordinary EOA and signs its own USDC. Shillings are not
 * the treasury's to sign: client TZS balances are backed by nTZS sitting in
 * the omnibus, which belongs to nTZS and has no key CAPX holds. The only way
 * out is the transfers API, sourced by `fromUserId` — the same endpoint, in
 * the opposite direction, that credits a deposit when a partner sends nTZS in.
 *
 * So there are two moving parts rather than one: the omnibus must actually
 * hold the shillings, which `ensureNtzsHasTzs` arranges by walking dollars
 * back and converting them, and then the transfer is requested.
 *
 * ## The same refund rule, for a different reason
 *
 * `withdrawUsdcToWallet` refuses to refund after broadcast because the
 * transaction is already public. Here the uncertainty is an HTTP one: a
 * timeout against the transfers API may still have moved money. nTZS says so
 * itself — `NtzsError.retry === "verify"` means exactly "this may have
 * happened" — and `payout.ts` already treats that as do-not-refund. The same
 * rule applies, read off the same field.
 */
export async function withdrawNtzsToWallet(input: {
  userId: string;
  amountTzs: number;
  to: string;
  key: string;
  via?: string;
}): Promise<NtzsWithdrawalResult> {
  const dest = parseDestination(input.to);
  if (!dest.ok) return { ok: false, code: "bad_destination", error: dest.error, status: 400 };

  const amountTzs = Math.round(Number(input.amountTzs));
  if (!Number.isFinite(amountTzs) || amountTzs <= 0) {
    return { ok: false, code: "bad_amount",
      error: "The amount must be a positive number of shillings.", status: 400 };
  }
  if (amountTzs < MIN_WITHDRAWAL_TZS) {
    return { ok: false, code: "below_minimum",
      error: `The smallest wallet withdrawal is ${MIN_WITHDRAWAL_TZS.toLocaleString()} TZS.`,
      status: 400 };
  }

  const held = await balanceOf(input.userId, "TZS").catch(() => null);
  if (held === null) {
    return { ok: false, code: "balance_unreadable",
      error: "The customer's balance could not be read just now. Nothing was sent; try again.",
      status: 503 };
  }
  if (amountTzs > held + 1e-9) {
    return { ok: false, code: "insufficient_balance",
      error: `That customer holds ${Math.floor(held).toLocaleString()} TZS.`, status: 409 };
  }

  /* Debited first, for the reason set out at the top of this file: money
     owed and still held is repairable, money gone and still spendable is not. */
  const ref = `ntzs-withdrawal:${input.key}`;
  const debit = await record([{
    userId: input.userId, kind: "withdrawal", asset: "TZS", amount: (-amountTzs).toString(),
    ref,
    metadata: { destination: dest.address, chain: "base", token: "NTZS",
                ...(input.via ? { via: input.via } : {}) },
  }]);
  if (debit.duplicate) {
    return { ok: false, code: "already_submitted",
      error: "A withdrawal with this key was already accepted. Check the customer's activity "
           + "for it rather than sending a second one.", status: 409 };
  }

  try {
    const { ensureNtzsHasTzs } = await import("./ntzsFunding");
    const { transferNtzs } = await import("./ntzs");
    const { omnibusUserId } = await import("./omnibus");

    /* The shillings may currently be dollars in the treasury; this walks them
       back and converts, confirming each step before the next. */
    await ensureNtzsHasTzs(amountTzs);

    const result = await transferNtzs({
      fromUserId: await omnibusUserId(),
      toAddress: dest.address,
      amountTzs,
      purpose: "customer_withdrawal",
      /* nTZS keys its own idempotency on this, so a retry inside their API is
         the same transfer rather than a second one. */
      reference: input.key,
    });

    const txHash = typeof result.txHash === "string" ? result.txHash : null;
    if (txHash) {
      const { db } = await import("./db");
      await db()`
        update capx.ledger_entries
           set metadata = metadata || ${JSON.stringify({ txHash })}::jsonb
         where ref = ${ref}`.catch(() => null);
    }

    return { ok: true, amountTzs, to: dest.address, txHash, reference: String(result.id ?? input.key) };
  } catch (e) {
    const { NtzsError } = await import("./ntzs");
    const err = e instanceof NtzsError ? e : null;
    const message = e instanceof Error ? e.message : "The transfer did not go through.";

    /*
     * "verify" is nTZS saying it may have moved the money. Refunding on that
     * pays the customer twice, so the debit stands and a person settles it —
     * the same call payout.ts makes on the same field.
     */
    if (err?.retry === "verify") {
      await alertStranded(input.userId, amountTzs, dest.address, input.key,
        `${message} (nTZS reported an uncertain outcome)`, "TZS");
      return { ok: false, code: "withdrawal_uncertain",
        error: "The transfer was requested but its outcome could not be confirmed. The balance "
             + "stays debited and CAPX is checking it — do not retry, as that would send twice.",
        status: 502 };
    }

    await record([{
      userId: input.userId, kind: "adjustment", asset: "TZS", amount: amountTzs.toString(),
      ref: `${ref}:refund`,
      metadata: { reason: message },
    }]).catch(() => null);
    return { ok: false, code: "withdrawal_failed",
      error: `${message} Nothing was sent and the balance is unchanged.`, status: 502 };
  }
}
