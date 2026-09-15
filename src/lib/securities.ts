import "server-only";
import { formatUnits } from "viem";
import { publicClient } from "./chain";
import { b20Abi } from "./abis";
import { db, migrate } from "./db";

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
