import "server-only";

/**
 * Platform fee configuration.
 *
 * The fee is a parameter on the aggregator route, so the router pays the
 * receiver inside the swap the user already signs — no extra approval, no extra
 * transaction, and CAPIMON never holds the funds.
 *
 * Off by default: charging a fee on securities transactions has licensing
 * consequences, so switching it on has to be a deliberate act, not a default.
 * Set FEE_BPS to enable.
 */

export const FEE_RECEIVER =
  (process.env.FEE_RECEIVER ?? "0xc7cC8B3169a3e17981D8429E1D0Cef8CCcD6104e") as `0x${string}`;

/** Hard ceiling so a mistyped env var cannot charge a user 20%. */
const MAX_FEE_BPS = 100;

export const FEE_BPS = Math.min(
  MAX_FEE_BPS,
  Math.max(0, Math.round(Number(process.env.FEE_BPS ?? 0) || 0)),
);

export const feeEnabled = FEE_BPS > 0;

export type FeeParams = {
  feeAmount: number;
  chargeFeeBy: "currency_in" | "currency_out";
  isInBps: true;
  feeReceiver: `0x${string}`;
};

/**
 * Always take the fee on whichever leg is USDC — charging the equity leg would
 * accrue fractional shares in thirteen different tokens.
 */
export function feeParams(side: "buy" | "sell"): FeeParams | null {
  if (!feeEnabled) return null;
  return {
    feeAmount: FEE_BPS,
    chargeFeeBy: side === "buy" ? "currency_in" : "currency_out",
    isInBps: true,
    feeReceiver: FEE_RECEIVER,
  };
}

/** What the user is paying, for disclosure in the UI. */
export function feeDisclosure(side: "buy" | "sell", amountUsd: number) {
  if (!feeEnabled) return null;
  return {
    bps: FEE_BPS,
    percent: FEE_BPS / 100,
    receiver: FEE_RECEIVER,
    token: "USDC" as const,
    chargedOn: side === "buy" ? ("input" as const) : ("output" as const),
    amountUsd: (amountUsd * FEE_BPS) / 10_000,
  };
}
