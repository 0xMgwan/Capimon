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
    caps.ramp.available ? rampBalance().then((b) => Number(b.balance ?? b.usdc ?? 0)).catch(() => 0) : 0,
    caps.wallets.available ? omnibusBalances().then((b) => b.usdc).catch(() => 0) : 0,
  ]);
  return parts.reduce((a, b) => a + b, 0);
}

export async function sweepToTreasury(usdc: number, toAddress: `0x${string}`) {
  const caps = await capabilities();
  if (!caps.wallets.available) {
    throw new NtzsError(
      "sweep_unavailable",
      "USDC is held on the nTZS side and cannot be moved automatically: the transfers endpoint " +
      "needs a user id, which requires the 'wallets' capability. Grant it, or send USDC to the " +
      `treasury at ${toAddress} manually.`,
      503,
    );
  }
  return transferUsdc({ fromUserId: await omnibusUserId(), toAddress, amount: usdc });
}
