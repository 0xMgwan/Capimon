import "server-only";
import { formatUnits } from "viem";
import { publicClient } from "./chain";
import { b20Abi } from "./abis";
import { db, migrate } from "./db";
import { SECURITIES_CONTRACTS } from "./assets";

/**
 * Where a tokenised security's supply is read from.
 *
 * The chain is the authority. A row in `issuance_events` records that someone
 * asked for a mint; only `totalSupply` says one happened. Keeping those two
 * apart matters because the app signs with the treasury key and the mint role
 * sits on the issuer — the web app cannot mint, so a recorded mint and a real
 * one are genuinely different events and had been treated as the same.
 *
 * Reading the chain also makes the failure visible in the safe direction. An
 * on-chain mint nobody wrote down used to be invisible to the backing check,
 * which would then happily authorise minting against custody that was already
 * spoken for. Now it shows up the moment supply is read.
 */

export type SecurityRow = {
  symbol: string;
  name: string;
  token_address: string | null;
  decimals: number;
  chain_id: number;
  status: string;
};

export async function securityRow(symbol: string): Promise<SecurityRow | null> {
  await migrate();
  const rows = await db()<SecurityRow[]>`
    select symbol, name, token_address, decimals, chain_id, status
      from capx.securities where symbol = ${symbol} limit 1`;
  return rows[0] ?? null;
}

export type Supply = {
  /** Shares outstanding. Whole shares, not base units. */
  quantity: number;
  /** "chain" when read from the token, "ledger" when there is no token yet. */
  source: "chain" | "ledger";
  tokenAddress: string | null;
};

/**
 * Tokens outstanding, in whole shares.
 *
 * Callers count shares and the token counts base units, so the conversion
 * happens here — once, at the boundary — rather than in each caller where the
 * two eventually drift apart.
 */
export async function onchainSupply(symbol: string): Promise<Supply | null> {
  const row = await securityRow(symbol);
  const token = row?.token_address;
  if (!row || !token) return null;

  const raw = await publicClient.readContract({
    address: token as `0x${string}`,
    abi: b20Abi,
    functionName: "totalSupply",
  });
  return {
    quantity: Number(formatUnits(raw as bigint, row.decimals)),
    source: "chain",
    tokenAddress: token,
  };
}


/**
 * The custody registry's ABI, kept here because it is the only caller.
 */
const custodyRegistryAbi = [
  { type: "function", name: "getCustodyPosition", stateMutability: "view",
    inputs: [{ name: "security", type: "string" }],
    outputs: [{ type: "tuple", components: [
      { name: "custodian", type: "string" },
      { name: "quantity", type: "uint256" },
      { name: "locked", type: "uint256" },
      { name: "issuedAt", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
      { name: "docRef", type: "string" },
      { name: "active", type: "bool" },
    ] }] },
  { type: "function", name: "verifiedQuantity", stateMutability: "view",
    inputs: [{ name: "security", type: "string" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isFresh", stateMutability: "view",
    inputs: [{ name: "security", type: "string" }], outputs: [{ type: "bool" }] },
] as const;

export type OnchainCustody = {
  custodian: string;
  /** Whole shares the custodian is recorded as holding. */
  quantity: number;
  /** Of those, the ones earmarked against tokens. */
  locked: number;
  issuedAt: string;
  expiresAt: string;
  /** False once the statement has expired, at which point it backs nothing. */
  fresh: boolean;
  docRef: string;
};

/**
 * The published custody statement.
 *
 * This is the record anyone can check, which is what makes it the one that
 * counts. The database copy is the desk's workflow — filed, approved, rejected
 * — and a workflow row is a statement of intent; only the registry entry is a
 * claim CAPX has actually made in public.
 *
 * Counts are whole shares here and base units on the token, so the conversion
 * belongs at this boundary rather than in whatever code compares them next.
 */
export async function onchainCustody(security: string): Promise<OnchainCustody | null> {
  const registry = SECURITIES_CONTRACTS.custodyRegistry as `0x${string}`;
  try {
    const [position, fresh] = await Promise.all([
      publicClient.readContract({
        address: registry, abi: custodyRegistryAbi,
        functionName: "getCustodyPosition", args: [security],
      }),
      publicClient.readContract({
        address: registry, abi: custodyRegistryAbi,
        functionName: "isFresh", args: [security],
      }),
    ]);
    const p = position as {
      custodian: string; quantity: bigint; locked: bigint;
      issuedAt: bigint; expiresAt: bigint; docRef: string; active: boolean;
    };
    if (!p.active) return null;
    return {
      custodian: p.custodian,
      quantity: Number(p.quantity),
      locked: Number(p.locked),
      issuedAt: new Date(Number(p.issuedAt) * 1000).toISOString(),
      expiresAt: new Date(Number(p.expiresAt) * 1000).toISOString(),
      fresh: Boolean(fresh),
      docRef: p.docRef,
    };
  } catch {
    // Unreadable is not the same as absent. The caller falls back to the
    // filed copy and says which one it used.
    return null;
  }
}
