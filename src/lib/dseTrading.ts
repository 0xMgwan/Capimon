import "server-only";
import { formatUnits } from "viem";
import { publicClient } from "./chain";
import { b20Abi } from "./abis";
import { treasuryAddress } from "./treasury";
import { readOraclePrice, refreshIfStale } from "./oracle";
import { totalLiabilities } from "./ledger";
import { FEE_BPS, feeEnabled } from "./fees";
import { CRDBT_DECIMALS, CRDBT_SECURITY } from "./assets";
import { dseSecurity, type DseSecurity } from "./dseSecurities";

/**
 * Buying and selling a tokenised DSE share against the treasury's holding.
 *
 * Written for CRDB first and now keyed by symbol: every registered DSE
 * security with a token trades the same way.
 *
 * Nothing about this touches a swap or a chain transaction. Shillings are
 * already the settlement currency, the price is already quoted in shillings,
 * and the treasury already holds the tokens — so a customer order is a ledger
 * entry against a position that exists, the same shape the US equities use once
 * their currency conversion is stripped away.
 *
 * The one thing that must hold is that client claims never exceed the tokens
 * the treasury actually holds. That is checked here, against the chain, rather
 * than inferred from what the ledger thinks it has sold.
 */

/** Share quantities carry the token's precision; anything finer is not real.
 *  Every DSE token is created at 8 decimals, so one precision serves all. */
const QTY_DP = CRDBT_DECIMALS;
/** Shillings are quoted whole by DSE but balances keep two places. */
const TZS_DP = 2;

const roundTo = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
/** Round a quantity *down*, so a rounding step can never sell what is not held. */
const floorTo = (n: number, dp: number) => Math.floor(n * 10 ** dp) / 10 ** dp;

export type DseMarket = {
  symbol: string;
  name: string;
  logo: string | null;
  status: string;
  /** Shillings per share, from the oracle. */
  price: number;
  /** False when the mark has aged past the contract's window. */
  fresh: boolean;
  updatedAt: string | null;
  source: string | null;
  /** Tokens the treasury holds. */
  custodyShares: number;
  /** Of those, the ones clients already have a claim on. */
  clientShares: number;
  /** What is left to sell. */
  availableShares: number;
  feeBps: number;
  tradable: boolean;
  /** Why not, when it is not. */
  haltReason: string | null;
};

/** Kept for callers that still name the old type. */
export type CrdbMarket = DseMarket;

/** Tokens the treasury holds, in whole shares. */
async function treasuryShares(sec: DseSecurity): Promise<number> {
  const addr = treasuryAddress();
  if (!addr) return 0;
  const raw = await publicClient.readContract({
    address: sec.token, abi: b20Abi, functionName: "balanceOf", args: [addr],
  });
  return Number(formatUnits(raw as bigint, sec.decimals));
}

export async function dseMarket(symbol: string): Promise<DseMarket | null> {
  const sec = await dseSecurity(symbol);
  if (!sec) return null;
  const S = sec.symbol;

  // Kicked off, never awaited: whoever loaded this page is not waiting on a
  // chain write, and the next reader gets the fresher mark.
  refreshIfStale(S);

  const [oracle, custodyShares, liabilities] = await Promise.all([
    readOraclePrice(S).catch(() => null),
    treasuryShares(sec).catch(() => 0),
    totalLiabilities().catch(() => []),
  ]);

  const clientShares = liabilities.find((l) => l.asset === S)?.amount ?? 0;
  const availableShares = Math.max(0, floorTo(custodyShares - clientShares, QTY_DP));

  let haltReason: string | null = null;
  // Going live is CAPX's decision on the desk; until then nobody can buy.
  if (sec.status !== "live") haltReason = sec.status === "suspended"
    ? `${S} trading is suspended.` : `${S} is not open for trading yet.`;
  else if (!oracle) haltReason = `No price has been published for ${S} yet.`;
  else if (!oracle.fresh) haltReason = `The ${S} price is stale — the exchange has not printed recently enough to trade against.`;
  else if (!(oracle.price > 0)) haltReason = `The published ${S} price is zero.`;
  else if (custodyShares <= 0) haltReason = `No ${S} shares are held in custody.`;

  return {
    symbol: S,
    name: sec.name,
    logo: sec.logo,
    status: sec.status,
    price: oracle?.price ?? 0,
    fresh: oracle?.fresh ?? false,
    updatedAt: oracle?.updatedAt ?? null,
    source: oracle?.source ?? null,
    custodyShares,
    clientShares,
    availableShares,
    feeBps: FEE_BPS,
    tradable: haltReason === null,
    haltReason,
  };
}

/** CRDB's market. Always present, since CRDB has a fallback registration. */
export async function crdbMarket(): Promise<DseMarket> {
  return (await dseMarket(CRDBT_SECURITY))!;
}

export type Quote = {
  side: "buy" | "sell";
  price: number;
  /** Shillings leaving (buy) or arriving (sell) in the customer's balance. */
  tzs: number;
  /** Shillings actually exchanged for shares, after the fee. */
  netTzs: number;
  fee: number;
  qty: number;
  feeBps: number;
};

/**
 * What a given order would do, priced and rounded exactly as it will settle.
 *
 * The fee comes off the cash leg on both sides, matching how the US equities
 * charge it — taking it in shares would leave CAPX accruing fractions of a
 * security it would then have to account for.
 */
export function quoteBuyTzs(price: number, tzs: number): Quote {
  const fee = feeEnabled ? roundTo((tzs * FEE_BPS) / 10_000, TZS_DP) : 0;
  const netTzs = roundTo(tzs - fee, TZS_DP);
  // Floor the shares: the customer is never credited more than their shillings
  // bought, and the difference stays as backing rather than being conjured.
  return { side: "buy", price, tzs: roundTo(tzs, TZS_DP), netTzs, fee, qty: floorTo(netTzs / price, QTY_DP), feeBps: FEE_BPS };
}

/**
 * Below this, a holding is not worth keeping on a page.
 *
 * A few millionths of a share prices to nothing, cannot be sold for anything,
 * and sits in the list looking like a position. Selling "almost all" leaves
 * exactly that, so a sale that would leave less than this takes the rest with
 * it rather than manufacturing a remainder nobody can use.
 */
export const DUST_SHARES = 0.001;

/** Rounds a sale up to the whole position when the remainder would be dust. */
export function sellQtyOrAll(requested: number, held: number): number {
  const remainder = held - requested;
  return remainder > 0 && remainder < DUST_SHARES ? held : requested;
}

export function quoteSellQty(price: number, qty: number): Quote {
  const gross = roundTo(qty * price, TZS_DP);
  const fee = feeEnabled ? roundTo((gross * FEE_BPS) / 10_000, TZS_DP) : 0;
  return { side: "sell", price, tzs: roundTo(gross - fee, TZS_DP), netTzs: gross, fee, qty: roundTo(qty, QTY_DP), feeBps: FEE_BPS };
}

/** Shares a shilling amount buys, for the "how many do I get" display. */
export function sharesFor(price: number, tzs: number): number {
  if (!(price > 0)) return 0;
  return quoteBuyTzs(price, tzs).qty;
}
