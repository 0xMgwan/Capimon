import "server-only";
import { formatUnits, parseUnits } from "viem";
import { publicClient } from "./chain";
import { treasuryAddress, signer, ensureAllowance } from "./treasury";
import { USDC_BASE } from "./assets";
import { aaveSpokeAbi } from "./abis";

/**
 * Idle dollars, earning what idle dollars should earn.
 *
 * The treasury holds USDC between a customer's deposit and their trade, and
 * on the way back out of a sell. That float sat at zero percent. Aave's
 * Coinbase Stocks market on Base pays real borrower interest on it — 3.14%
 * at the time of writing, against $7.88M supplied and $6.92M borrowed — so
 * the money works while it waits.
 *
 * ## Why this market and not the equities in it
 *
 * The same spoke lists the eight tokenised stocks. They are *not borrowable*:
 * `borrowable` is false on every one, the borrowed balance is exactly zero,
 * and their supply share price has never moved off 1.000000000. Supplying a
 * share there earns nothing from the protocol — it only makes the share
 * collateral for a loan. So nothing in this file touches customer securities.
 * It supplies house-held USDC and that is all.
 *
 * ## What it must never do
 *
 * Break a trade. Every buy calls `ensureTreasuryFunded`, which reads the
 * treasury's USDC balance; dollars sitting in Aave are not in that balance.
 * Two rules follow, and both are enforced elsewhere as well as here:
 *
 *   - a buffer stays on-chain, so the ordinary order never has to unwind
 *     anything to settle;
 *   - every place that asks "how much can we reach" counts this position,
 *     and the funder can actually withdraw it. A pre-flight that counts less
 *     than the funder can reach refuses orders that would have gone through,
 *     which is the failure it exists to prevent arriving one step earlier.
 *
 * ## Accounting
 *
 * Supplying does not change what CAPX owes anybody, so solvency has to see
 * through it: `treasuryHoldings` adds this position to the on-chain balance.
 * Interest accrues as share appreciation — the share count is fixed and each
 * share buys more USDC over time — so the position is read as shares and
 * converted at the reserve's live rate rather than remembered as a number.
 */

/** Aave v4 "Coinbase Stocks" spoke on Base. Verified: holds the live book. */
export const AAVE_SPOKE = "0x17905Db0e4A3514467539956c084180616AE7B8D" as const;
/** The hub actually custodies the deposits; its balance is the exit liquidity. */
export const AAVE_HUB = "0xa4d5947Eb727A052bae69C593FfC84247EC9864E" as const;
/** Reserve 7 of 9. Checked on-chain: underlying is USDC, six decimals. */
export const USDC_RESERVE = 7n;

/**
 * Off unless a deployment turns it on.
 *
 * Reading the position is always on — if dollars are ever supplied, by this
 * code or by hand, every balance that matters must count them. Only the act
 * of supplying is gated, so turning the flag off stops new supply and leaves
 * withdrawal working.
 */
export const yieldEnabled = (process.env.AAVE_YIELD ?? "").toLowerCase() === "on";

/**
 * Dollars that stay on-chain no matter what.
 *
 * Sized to cover an ordinary order without a withdrawal in the path. Too low
 * and every buy unwinds a position first; too high and nothing earns.
 */
export const BUFFER_USDC = Math.max(0, Number(process.env.AAVE_YIELD_BUFFER ?? 25));

/** Below this, supplying costs more in gas than it earns. */
const MIN_SUPPLY_USDC = 5;

/* ---------------------------------------------------------- the decisions -- */

/**
 * Dollars a holding is worth, from shares and the reserve's live totals.
 *
 * Integer maths before the conversion to a float: the multiply overflows a
 * double long before it overflows a uint120, and rounding a share count to
 * fifteen significant digits and *then* scaling it is how a position reports
 * a few cents that were never there.
 */
export function sharesToAssets(
  shares: bigint, totalAssets: bigint, totalShares: bigint, decimals = 6,
): number {
  if (totalShares <= 0n || shares <= 0n) return 0;
  return Number(formatUnits((shares * totalAssets) / totalShares, decimals));
}

/**
 * What may be supplied, leaving the buffer behind.
 *
 * Returns 0 rather than a small number below the minimum: a supply costs an
 * approval and a transaction, and lending four dollars at three percent earns
 * twelve cents a year to spend more than that on gas.
 */
export function suppliableSurplus(
  onChain: number, buffer: number, min = MIN_SUPPLY_USDC,
): number {
  const surplus = onChain - buffer;
  return surplus >= min ? surplus : 0;
}

/**
 * What a withdrawal can actually get: never more than is held, and never
 * more than the hub can pay today. Asking for more than the liquidity does
 * not fail, it just pays less — so the caller is told the real figure rather
 * than the hoped-for one.
 */
export function withdrawable(want: number, supplied: number, liquidity: number): number {
  if (!(want > 0)) return 0;
  return Math.max(0, Math.min(want, supplied, liquidity));
}

type Position = {
  /** USDC supplied, at the reserve's live share rate. */
  supplied: number;
  /** Shares held — fixed as interest accrues; the rate moves instead. */
  shares: bigint;
  /** USDC the hub can pay out right now, which bounds any withdrawal. */
  liquidity: number;
};

/**
 * What the treasury has in the market, priced at the live rate.
 *
 * Never throws. Every caller is on a path where an unreadable position must
 * not be mistaken for an empty one — solvency would report a shortfall, and
 * the funder would refuse a fundable order — so failure returns null and the
 * callers treat null as "unknown", not as zero.
 */
export async function aavePosition(): Promise<Position | null> {
  const treasury = treasuryAddress();
  if (!treasury) return null;
  try {
    const [pos, assets, shares, liquidity] = await Promise.all([
      publicClient.readContract({
        address: AAVE_SPOKE, abi: aaveSpokeAbi, functionName: "getUserPosition",
        args: [USDC_RESERVE, treasury],
      }),
      publicClient.readContract({
        address: AAVE_SPOKE, abi: aaveSpokeAbi, functionName: "getReserveSuppliedAssets",
        args: [USDC_RESERVE],
      }),
      publicClient.readContract({
        address: AAVE_SPOKE, abi: aaveSpokeAbi, functionName: "getReserveSuppliedShares",
        args: [USDC_RESERVE],
      }),
      publicClient.readContract({
        address: USDC_BASE, abi: [{
          type: "function", name: "balanceOf", stateMutability: "view",
          inputs: [{ type: "address" }], outputs: [{ type: "uint256" }],
        }] as const, functionName: "balanceOf", args: [AAVE_HUB],
      }),
    ]);

    const mine = (pos as { suppliedShares: bigint }).suppliedShares;
    const totalAssets = assets as bigint;
    const totalShares = shares as bigint;
    /* Shares are worthless as a number without the rate, and the rate is a
       ratio of two live totals rather than anything stored. */
    const supplied = sharesToAssets(mine, totalAssets, totalShares);

    return { supplied, shares: mine, liquidity: Number(formatUnits(liquidity as bigint, 6)) };
  } catch {
    return null;
  }
}

/** The position's size, or 0 when it cannot be read — for display only. */
export async function suppliedUsdc(): Promise<number> {
  return (await aavePosition())?.supplied ?? 0;
}

/**
 * Takes dollars back out, up to what is there and what the hub can pay.
 *
 * Returns what actually arrived, read from the treasury's balance either side
 * rather than from the amount asked for: a withdrawal capped by liquidity
 * pays less than requested, and a caller that assumed otherwise would go on
 * to spend money it does not have.
 */
export async function withdrawFromAave(wantUsdc: number): Promise<number> {
  if (!(wantUsdc > 0)) return 0;
  const pos = await aavePosition();
  if (!pos || pos.supplied <= 0) return 0;

  const take = withdrawable(wantUsdc, pos.supplied, pos.liquidity);
  if (!(take > 0)) return 0;

  const { wallet, account } = signer();
  const before = await usdcBalance(account.address);

  const hash = await wallet.writeContract({
    address: AAVE_SPOKE, abi: aaveSpokeAbi, functionName: "withdraw",
    args: [USDC_RESERVE, parseUnits(take.toFixed(6), 6), account.address],
    chain: wallet.chain, account,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const after = await usdcBalance(account.address);
  return Math.max(0, after - before);
}

/**
 * Puts the idle surplus to work, keeping the buffer on-chain.
 *
 * Deliberately does nothing rather than something small: a two-dollar supply
 * costs two transactions in gas and earns six cents a year. It also refuses
 * while the flag is off, so a deployment that has not opted in cannot have
 * its float moved by a sweep that happens to run.
 */
export async function supplyIdleUsdc(): Promise<{ supplied: number; reason?: string }> {
  if (!yieldEnabled) return { supplied: 0, reason: "disabled" };
  const treasury = treasuryAddress();
  if (!treasury) return { supplied: 0, reason: "no treasury" };

  const onChain = await usdcBalance(treasury);
  const surplus = suppliableSurplus(onChain, BUFFER_USDC);
  if (!(surplus > 0)) {
    return { supplied: 0, reason: `only ${(onChain - BUFFER_USDC).toFixed(2)} over the buffer` };
  }

  const { wallet, account } = signer();
  const amount = parseUnits(surplus.toFixed(6), 6);

  /* The spoke pulls the tokens, so it needs the allowance first. */
  await ensureAllowance(USDC_BASE, AAVE_SPOKE, amount);

  const hash = await wallet.writeContract({
    address: AAVE_SPOKE, abi: aaveSpokeAbi, functionName: "supply",
    args: [USDC_RESERVE, amount, account.address],
    chain: wallet.chain, account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { supplied: surplus };
}

async function usdcBalance(who: `0x${string}`): Promise<number> {
  const raw = await publicClient.readContract({
    address: USDC_BASE, abi: [{
      type: "function", name: "balanceOf", stateMutability: "view",
      inputs: [{ type: "address" }], outputs: [{ type: "uint256" }],
    }] as const, functionName: "balanceOf", args: [who],
  });
  return Number(formatUnits(raw as bigint, 6));
}
