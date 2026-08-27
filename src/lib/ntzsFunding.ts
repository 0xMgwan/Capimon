import "server-only";
import { transferUsdc, rampBalance, NtzsError } from "./ntzs";
import { omnibusUserId, omnibusBalances, capabilities } from "./omnibus";

/**
 * Moving USDC from the nTZS side into the CAPX treasury.
 *
 * On-ramped USDC is delivered to nTZS's settlement float — an address CAPX does
 * not hold the key for — so this crossing has to go through the API. The
 * transfers endpoint is the only one that can send USDC to an arbitrary
 * address, and it requires a user id, which is why the `wallets` grant gates
 * automated funding.
 */

export async function ntzsAvailableUsdc() {
  const caps = await capabilities();
  const parts = await Promise.all([
    caps.ramp.available ? rampBalance().then((b) => Number(b.usdcBalance ?? b.balance ?? b.usdc ?? 0)).catch(() => 0) : 0,
    caps.wallets.available ? omnibusBalances().then((b) => b.usdc).catch(() => 0) : 0,
  ]);
  return parts.reduce((a, b) => a + b, 0);
}

/**
 * USDC that can actually be moved to the treasury.
 *
 * Deliberately excludes the ramp settlement float. The float backs client
 * balances and counts toward solvency, but transfers are sourced by
 * `fromUserId` only — there is no address-sourced transfer — so float USDC
 * cannot be sent to the treasury by API. Treating it as sweepable made a buy
 * attempt an impossible move and fail confusingly.
 */
export async function sweepableUsdc() {
  const caps = await capabilities();
  if (!caps.wallets.available) return 0;
  return omnibusBalances().then((b) => b.usdc).catch(() => 0);
}

export async function sweepToTreasury(usdc: number, toAddress: `0x${string}`) {
  const caps = await capabilities();

  // Only a provisioned user wallet can source a transfer.
  if (caps.wallets.available) {
    return transferUsdc({ fromUserId: await omnibusUserId(), toAddress, amount: usdc });
  }

  const float = await rampBalance()
    .then((b) => Number(b.usdcBalance ?? b.balance ?? b.usdc ?? 0))
    .catch(() => 0);

  throw new NtzsError(
    "sweep_unavailable",
    `USDC cannot be moved to the treasury automatically. ${float.toFixed(2)} USDC is sitting in the ` +
    `ramp settlement float, which the transfers API cannot source from — transfers require a ` +
    `provisioned user wallet (fromUserId). Give the CAPX omnibus user a wallet, or fund the ` +
    `treasury at ${toAddress} directly.`,
    503,
  );
}

/**
 * Puts shillings within reach of a payout.
 *
 * A withdrawal is paid out of the nTZS account, but the money backing it may be
 * sitting as USDC in the treasury. This walks it back: the treasury signs USDC
 * over to the omnibus wallet, that USDC is swapped to shillings, and the payout
 * runs from there. Each step is confirmed before the next, so a withdrawal is
 * never requested against a balance that has not arrived.
 */
export async function ensureNtzsHasTzs(amountTzs: number) {
  const caps = await capabilities();
  if (!caps.wallets.available) {
    throw new NtzsError("wallets_required",
      "Moving funds back to nTZS needs the 'wallets' capability.", 503);
  }

  const before = await omnibusBalances();
  if (before.tzs >= amountTzs) return { moved: 0, swapped: 0, tzs: before.tzs };

  const missingTzs = amountTzs - before.tzs;
  const { getSwapRate, swap } = await import("./ntzs");

  // Price the shortfall, then send a little over so the swap's own spread does
  // not leave the payout a few shillings short.
  const rate = await getSwapRate("NTZS", "USDC", Math.max(1000, Math.round(missingTzs)));
  const impliedUsdc = Number(rate.expectedOutput ?? 0);
  if (!(impliedUsdc > 0)) throw new NtzsError("rate_unavailable", "No rate is available to price this withdrawal.", 503);
  const needUsdc = impliedUsdc * 1.02;

  if (before.usdc < needUsdc) {
    const { sendUsdcToNtzs } = await import("./treasury");
    if (!before.walletAddress) {
      throw new NtzsError("no_ntzs_address", "The nTZS wallet has no address to send USDC to.", 503);
    }
    await sendUsdcToNtzs(needUsdc - before.usdc, before.walletAddress as `0x${string}`);

    // Wait for nTZS to see it before asking it to swap.
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const now = await omnibusBalances();
      if (now.usdc >= needUsdc) break;
    }
  }

  const mid = await omnibusBalances();
  const swapUsdc = Math.min(mid.usdc, needUsdc);
  if (!(swapUsdc > 0)) throw new NtzsError("funding_incomplete", "USDC has not arrived at nTZS yet.", 409);

  await swap({ userId: await omnibusUserId(), from: "USDC", to: "NTZS", amount: swapUsdc });

  const after = await omnibusBalances();
  if (after.tzs < amountTzs) {
    throw new NtzsError("funding_incomplete",
      `Converted to shillings but nTZS shows ${Math.floor(after.tzs).toLocaleString()} TZS against ` +
      `${amountTzs.toLocaleString()} needed. Nothing was paid out.`, 409);
  }
  return { moved: needUsdc, swapped: swapUsdc, tzs: after.tzs };
}

/**
 * Swaps a shilling balance into USDC, for a buy.
 *
 * A shilling account holds TZS until the moment it invests; this is that
 * moment. The omnibus swaps the shillings to USDC and leaves it in the nTZS
 * float, where the treasury's own pre-trade top-up sweeps it on-chain and waits
 * for it to land. So the rate the user gets is the rate at the instant they
 * buy, and the on-chain arrival is confirmed by the same tested path a USDC
 * buy uses. Returns the USDC actually delivered, which is what the buy is sized
 * to.
 */
export async function swapTzsToUsdc(amountTzs: number) {
  const caps = await capabilities();
  if (!caps.wallets.available) {
    throw new NtzsError("wallets_required",
      "Spending a shilling balance needs the 'wallets' capability to swap USDC.", 503);
  }
  const { swap } = await import("./ntzs");
  const userId = await omnibusUserId();

  const before = await omnibusBalances();
  if (before.tzs < amountTzs) {
    throw new NtzsError("insufficient_omnibus_tzs",
      `The omnibus holds ${Math.floor(before.tzs).toLocaleString()} TZS against ` +
      `${amountTzs.toLocaleString()} to convert.`, 409);
  }

  await swap({ userId, from: "NTZS", to: "USDC", amount: amountTzs });

  const after = await omnibusBalances();
  const usdc = Math.max(0, after.usdc - before.usdc);
  if (!(usdc > 0)) {
    throw new NtzsError("swap_incomplete", "Swapped shillings but no USDC is visible yet.", 409);
  }
  return { usdc, tzsSpent: amountTzs };
}
