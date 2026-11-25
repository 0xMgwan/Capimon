import "server-only";
import { getAddress } from "viem";
import { publicClient } from "./chain";
import { SECURITIES_CONTRACTS } from "./assets";

/**
 * Whether a maker can actually be the other side of a settled trade.
 *
 * A maker exists in two places and needs to be in both. In the ledger it is
 * an account holding shillings and shares, which is enough to be allocated an
 * order. On chain it is an address that `SettlementEngine.settle()` moves a
 * token and cash between, and that `InvestorRegistry` has approved — and
 * without that, an allocation decided in makers.ts is a decision that cannot
 * be carried out.
 *
 * The two conditions are separate and fail differently, so they are reported
 * separately rather than collapsed into one boolean. A maker with no address
 * is waiting on a custody decision somebody has to make. A maker with an
 * address the registry has not approved is waiting on an on-chain
 * transaction. Telling a desk only that a maker "cannot settle" would leave
 * them to work out which, and they are not the same afternoon's work.
 *
 * ## Why the registry is read and not assumed
 *
 * `settle()` reverts with `BuyerNotApproved` or `SellerNotApproved` if either
 * party is unapproved or frozen. Discovering that from a reverted transaction
 * means a customer's order has already been accepted, priced and recorded
 * before anybody finds out the counterparty was ineligible — and a freeze is
 * precisely the case where somebody has decided this party should stop
 * trading, which is the worst possible time to learn about it late.
 */

/** The registry's own view of one address. */
export const investorRegistryAbi = [
  {
    type: "function", name: "isAuthorized", stateMutability: "view",
    inputs: [{ name: "investor", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export type PartyStatus = {
  address: `0x${string}` | null;
  /** False when there is no address at all. */
  hasAddress: boolean;
  /**
   * The registry's answer, or null when it could not be asked.
   *
   * Null is not false. An unreachable RPC is our problem, not evidence that
   * a counterparty is unapproved, and treating it as a refusal would take
   * every maker off the book the moment a node went quiet.
   */
  approved: boolean | null;
  /** Both conditions met: this party can be passed to settle(). */
  canSettle: boolean;
  reason: string | null;
};

/**
 * Normalises an address, or rejects it.
 *
 * Checksums are validated rather than stripped. A mistyped address usually
 * fails the checksum, and the alternative — lowercasing whatever arrives —
 * accepts the typo and stores a destination that belongs to nobody, which is
 * only discovered when a settlement sends a token there.
 */
export function normaliseAddress(raw: string): `0x${string}` | null {
  const v = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return null;

  /*
   * An address written in a single case carries no checksum to verify.
   *
   * EIP-55 encodes the checksum in the capitalisation, so an all-lowercase
   * or all-uppercase address is simply one that was never checksummed —
   * which plenty of tools and block explorers print. viem's getAddress
   * throws on both rather than passing them through, so they are handled
   * here instead of being refused as typos.
   */
  const body = v.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) {
    return `0x${body.toLowerCase()}` as `0x${string}`;
  }

  /*
   * Mixed case is a checksum, so it is checked — by comparison, not by
   * getAddress.
   *
   * getAddress *recomputes* the capitalisation rather than validating it. Given
   * a mistyped checksummed address it returns a correctly capitalised one and
   * throws nothing, so `try { getAddress(v) } catch { reject }` validates
   * precisely nothing and accepts every typo it was written to catch. The
   * only way to use it as a check is to compare its output with the input.
   *
   * What that buys: the checksum is computed over the hex digits, so a
   * mistyped digit produces a different capitalisation pattern and fails the
   * comparison. An address pasted with a checksum is therefore verified
   * against the one its owner published, which is worth having for a
   * destination that tokens get sent to.
   */
  let checksummed: string;
  try {
    checksummed = getAddress(v);
  } catch {
    return null;
  }
  if (checksummed !== v) return null;
  return v.toLowerCase() as `0x${string}`;
}

/* The registry changes when somebody is approved, revoked or frozen — rare,
   but a freeze is urgent, so this is short rather than generous. */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; approved: boolean | null }>();

/** Whether the registry approves one address, cached briefly. */
export async function isApproved(address: `0x${string}`): Promise<boolean | null> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.approved;

  let approved: boolean | null = null;
  try {
    approved = await publicClient.readContract({
      address: SECURITIES_CONTRACTS.investorRegistry as `0x${string}`,
      abi: investorRegistryAbi,
      functionName: "isAuthorized",
      args: [address],
    }) as boolean;
  } catch {
    /* Left null and deliberately not cached as false: an outage must not
       look like a revocation, and must not persist past the outage. */
    approved = null;
  }

  if (approved !== null) cache.set(key, { at: Date.now(), approved });
  return approved;
}

/** Forgets what the registry said, for after an approval is sent. */
export function forgetApproval(address?: string): void {
  if (address) cache.delete(address.toLowerCase());
  else cache.clear();
}

/**
 * The settlement standing of one party, from an address that may be absent.
 *
 * Pure in everything but the registry read, so the ordering of the checks is
 * visible: no address is answered without troubling the chain, since there is
 * nothing to ask about.
 */
export async function partyStatus(raw: string | null): Promise<PartyStatus> {
  const address = raw ? normaliseAddress(raw) : null;

  if (!raw) {
    return { address: null, hasAddress: false, approved: null, canSettle: false,
      reason: "no settlement address on file" };
  }
  if (!address) {
    return { address: null, hasAddress: false, approved: null, canSettle: false,
      reason: "the address on file is not a valid address" };
  }

  const approved = await isApproved(address);
  return {
    address,
    hasAddress: true,
    approved,
    canSettle: approved === true,
    reason: approved === true ? null
      : approved === false ? "not approved in the investor registry"
      : "the investor registry could not be read",
  };
}
