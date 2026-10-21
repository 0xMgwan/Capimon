import "server-only";
import { formatUnits, type Log } from "viem";
import { publicClient } from "./chain";
import { db, migrate } from "./db";
import { record } from "./ledger";
import { NTZS_BASE, USDC_BASE } from "./assets";

/**
 * Money that arrives as a stablecoin transfer rather than a collection.
 *
 * Every other way into CAPX is a fiat rail: a mobile money prompt or a bank
 * push, credited only once nTZS confirms the collection landed. That is the
 * right shape for a customer with shillings in their pocket and the wrong
 * shape for a partner whose customers already hold nTZS — under the fiat-only
 * rails, a NEDApay customer wanting CRDB would have to withdraw their nTZS to
 * mobile money so CAPX could prompt that same phone to collect it back.
 *
 * So a partner can transfer nTZS or USDC to the omnibus wallet and name the
 * customer it belongs to. The crediting rule does not change at all, and it is
 * the only rule that matters here:
 *
 *   **Nothing is credited on the caller's word.**
 *
 * The transaction is read from the chain by its own hash, the recipient must
 * be the omnibus wallet, and the amount credited is the amount the Transfer
 * log actually carries — never the amount the caller said they sent. A unique
 * index on the hash means resubmitting the same transaction credits nobody
 * twice, which is the same guard `otc.ts` puts on `funding_tx` and for the
 * same reason.
 */

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type StableToken = "NTZS" | "USDC";

const TOKEN: Record<StableToken, { address: `0x${string}`; asset: string }> = {
  NTZS: { address: NTZS_BASE as `0x${string}`, asset: "TZS" },
  USDC: { address: USDC_BASE, asset: "USDC" },
};

export type CreditResult =
  | { ok: true; depositId: string; token: StableToken; asset: string; amount: number;
      txHash: string; duplicate?: boolean }
  | { ok: false; code: string; error: string; status: number };

const refuse = (code: string, error: string, status = 400): CreditResult =>
  ({ ok: false, code, error, status });

/**
 * Sums what a transaction actually delivered to one address.
 *
 * Read from the receipt's own logs rather than from a balance, because a
 * balance is shared: differencing the omnibus before and after attributes
 * every other customer's movement in the same window to this one deposit.
 * That exact mistake once credited seven times what had been paid.
 */
function deliveredTo(logs: readonly Log[], token: `0x${string}`, to: string): bigint {
  const want = to.toLowerCase().slice(2).padStart(64, "0");
  let sum = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== token.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if ((log.topics[2] ?? "").toLowerCase() !== "0x" + want) continue;
    sum += BigInt(log.data);
  }
  return sum;
}

export async function creditStablecoinTransfer(input: {
  userId: string;
  txHash: string;
  token: StableToken;
  partnerId?: string;
}): Promise<CreditResult> {
  const txHash = input.txHash.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    return refuse("bad_tx_hash", "`tx_hash` must be a 0x-prefixed 32-byte transaction hash.");
  }
  const spec = TOKEN[input.token];
  if (!spec) return refuse("bad_token", "`token` must be NTZS or USDC.");

  await migrate();
  const sql = db();

  /* Already credited? Say so plainly rather than failing — a partner retrying
     after a dropped response is asking a reasonable question. */
  const [seen] = await sql<{ id: string; user_id: string; amount_tzs: string;
                             usdc_credited: string | null }[]>`
    select id::text, user_id::text, amount_tzs::text, usdc_credited::text
      from capx.deposits where lower(funding_tx) = ${txHash}`;
  if (seen) {
    if (seen.user_id !== input.userId) {
      return refuse("tx_already_used",
        "That transaction has already funded a different customer.", 409);
    }
    return { ok: true, depositId: seen.id, token: input.token, asset: spec.asset,
      amount: input.token === "USDC" ? Number(seen.usdc_credited ?? 0) : Number(seen.amount_tzs),
      txHash, duplicate: true };
  }

  const { omnibusBalances } = await import("./omnibus");
  const omnibus = await omnibusBalances().catch(() => null);
  const wallet = omnibus?.walletAddress;
  if (!wallet) {
    return refuse("no_omnibus_wallet",
      "The omnibus has no wallet address to receive transfers yet.", 503);
  }

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return refuse("tx_not_found",
      "That transaction could not be read on Base. If it was only just sent, wait for it to "
      + "confirm and try again.", 404);
  }
  if (receipt.status !== "success") {
    return refuse("tx_reverted", "That transaction did not succeed on chain.", 409);
  }

  const raw = deliveredTo(receipt.logs, spec.address, wallet);
  if (raw <= 0n) {
    return refuse("no_transfer_found",
      `That transaction moved no ${input.token} to the CAPX omnibus wallet (${wallet}). `
      + "Check the token and the recipient.", 409);
  }

  /* Decimals from the token itself: nTZS is 18 and USDC is 6, and hardcoding
     either is the kind of assumption that survives until it does not. */
  let decimals = input.token === "USDC" ? 6 : 18;
  try {
    const d = await publicClient.readContract({
      address: spec.address,
      abi: [{ name: "decimals", type: "function", stateMutability: "view",
              inputs: [], outputs: [{ type: "uint8" }] }] as const,
      functionName: "decimals",
    });
    decimals = Number(d);
  } catch { /* the default above matches what is deployed today */ }

  const amount = Number(formatUnits(raw, decimals));
  if (!(amount > 0)) {
    return refuse("amount_unreadable", "The transfer amount could not be read.", 409);
  }

  /*
   * The row carries the hash, and the unique index on it is what makes this
   * safe to call twice. Written before the ledger entry, so a crash between
   * the two leaves a settled deposit with no credit — recoverable — rather
   * than a credit with nothing behind it.
   */
  const [row] = await sql<{ id: string }[]>`
    insert into capx.deposits
      (user_id, amount_tzs, usdc_credited, phone, status, settled_at, funding_tx, partner_id, metadata)
    values (${input.userId}::uuid,
            ${input.token === "NTZS" ? amount : 0},
            ${input.token === "USDC" ? amount : null},
            '', 'settled', now(), ${txHash},
            ${input.partnerId ?? null}, ${sql.json({
              route: "stablecoin-transfer", token: input.token, txHash,
              paymentMethod: "stablecoin_transfer",
            } as never)})
    returning id::text`;

  await record([{
    userId: input.userId, kind: "deposit", asset: spec.asset, amount: amount.toString(),
    ref: `deposit:${row.id}`,
    metadata: { route: "stablecoin-transfer", token: input.token, txHash },
  }]);

  return { ok: true, depositId: row.id, token: input.token, asset: spec.asset, amount, txHash };
}
