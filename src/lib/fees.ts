import "server-only";

/**
 * Platform fee configuration.
 *
 * The fee is a parameter on the aggregator route, so the router pays the
 * receiver inside the swap the user already signs — no extra approval, no extra
 * transaction, and CAPX never holds the funds.
 *
 * Live at 250 bps, of which 100 belongs to the broker that tokenised the
 * security and the rest to CAPX. Set FEE_BPS to change the total, or FEE_BPS=0
 * to switch it off without a deploy. Charging a fee on securities transactions
 * carries licensing obligations — that is a business decision, taken
 * deliberately, not a default that drifted in.
 */

export const FEE_RECEIVER =
  (process.env.FEE_RECEIVER ?? "0xc7cC8B3169a3e17981D8429E1D0Cef8CCcD6104e") as `0x${string}`;

/**
 * Hard ceiling so a mistyped env var cannot charge a user 20%.
 *
 * Kept above the configured rate rather than equal to it. Pinned at the same
 * value, the clamp stops being a guard: every typo above it lands on exactly
 * the number that was wanted, so a wrong one is indistinguishable from a right
 * one until someone reads the config.
 */
const MAX_FEE_BPS = 400;

const DEFAULT_FEE_BPS = 250;

// An explicit FEE_BPS wins, including "0" to disable. An unset or unparseable
// value falls back to the default rather than silently charging nothing.
const configured = process.env.FEE_BPS?.trim();
const parsed = configured !== undefined && configured !== "" ? Number(configured) : DEFAULT_FEE_BPS;

export const FEE_BPS = Math.min(
  MAX_FEE_BPS,
  Math.max(0, Math.round(Number.isFinite(parsed) ? parsed : DEFAULT_FEE_BPS)),
);

export const feeEnabled = FEE_BPS > 0;

/**
 * The broker's share of it.
 *
 * FIMCO holds the shares, files the attestation that lets them be tokenised
 * and carries the regulated relationship with the exchange. A hundred basis
 * points of the two hundred and fifty is theirs, and the rest is CAPX's.
 *
 * Clamped to the total, because a split that pays out more than was collected
 * is not a configuration mistake anybody notices until the money is short.
 */
const brokerConfigured = process.env.BROKER_FEE_BPS?.trim();
const brokerParsed = brokerConfigured !== undefined && brokerConfigured !== ""
  ? Number(brokerConfigured) : 100;

export const BROKER_FEE_BPS = Math.min(
  FEE_BPS,
  Math.max(0, Math.round(Number.isFinite(brokerParsed) ? brokerParsed : 100)),
);

/** What is left for CAPX once the broker has been paid. */
export const CAPX_FEE_BPS = FEE_BPS - BROKER_FEE_BPS;

/** The broker's cut of a fee already charged, in shillings. */
export function brokerShare(fee: number): number {
  if (!feeEnabled || BROKER_FEE_BPS <= 0) return 0;
  return Math.round((fee * BROKER_FEE_BPS) / FEE_BPS * 100) / 100;
}

export type FeeParams = {
  feeAmount: number;
  chargeFeeBy: "currency_in" | "currency_out";
  isInBps: true;
  feeReceiver: `0x${string}`;
};

/**
 * Always take the fee on whichever leg is cash — charging the equity leg would
 * accrue fractional shares in fourteen different tokens.
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

/**
 * Where swept fees are sent.
 *
 * Deliberately has no default. Everything else here can fall back to something
 * sensible because getting it wrong charges a slightly wrong amount; getting
 * this wrong sends money to the wrong address. An unset value disables sweeping
 * rather than picking a destination on the operator's behalf.
 */
export const FEE_SWEEP_ADDRESS = (process.env.FEE_SWEEP_ADDRESS ?? "").trim().toLowerCase();
export const feeSweepConfigured = /^0x[0-9a-f]{40}$/.test(FEE_SWEEP_ADDRESS);

/**
 * Below this, a sweep costs more attention than it moves.
 *
 * Fees accrue a few shillings at a time, and a transfer per trade would be a
 * lot of moving parts for money that is not going anywhere.
 */
export const FEE_SWEEP_MIN_TZS = Number(process.env.FEE_SWEEP_MIN_TZS ?? 5_000);
