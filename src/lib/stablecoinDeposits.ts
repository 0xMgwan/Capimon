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
 *
 * ## Waiting for the block to be safe
 *
 * Base is an L2, so a transaction being mined is not the same as it being
 * final. The sequencer's unsafe head can be reorged, and a balance credited
 * from a transaction that is later reorged out is money CAPX gave away.
 *
 * Counting confirmations on the L2 is the obvious guard and the weak one: it
 * measures how many blocks the same sequencer has built on top, which is
 * exactly what a reorg replaces. The real line is the `safe` tag, which means
 * the batch containing this transaction has been posted to Ethereum. On Base
 * that runs about a minute behind the head — a cost worth paying once, and
 * invisible on a deposit nobody is watching a spinner for.
 *
 * So a transfer that is mined but not yet safe is **recorded and not
 * credited**: the row claims the hash, so nothing else can use it and the
 * partner can stop worrying about it, and the scheduled pass credits it the
 * moment the batch lands. The confirmation count survives only as a fallback
 * for an RPC that cannot answer `safe` at all.
 */

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type StableToken = "NTZS" | "USDC";

const TOKEN: Record<StableToken, { address: `0x${string}`; asset: string }> = {
  NTZS: { address: NTZS_BASE as `0x${string}`, asset: "TZS" },
  USDC: { address: USDC_BASE, asset: "USDC" },
};

/**
 * How many L2 blocks to accept instead, when `safe` cannot be read.
 *
 * Only a fallback. Base's safe head sits around thirty blocks behind, so this
 * is the same wait expressed in the weaker unit — chosen to match, not to be
 * independently meaningful.
 */
const FALLBACK_CONFIRMATIONS =
  Math.max(1, Number(process.env.DEPOSIT_CONFIRMATIONS ?? 30) || 30);

export type Finality = {
  confirmations: number;
  safe: boolean;
  /** Why it is not creditable yet, for a message a person can act on. */
  waitingFor: string | null;
};

/**
 * Whether a mined block can be credited from.
 *
 * Asks the chain for its safe head rather than inferring one. If that cannot
 * be read — an RPC that does not serve the tag — it falls back to counting
 * confirmations, and says which test it applied rather than reporting a
 * confidence it did not establish.
 */
export function finalityFrom(input: {
  blockNumber: bigint;
  latest: bigint | null;
  safeHead: bigint | null;
  minConfirmations?: number;
}): Finality {
  const { blockNumber, latest, safeHead } = input;
  const min = input.minConfirmations ?? FALLBACK_CONFIRMATIONS;
  const confirmations = latest === null ? 0 : Math.max(0, Number(latest - blockNumber) + 1);

  if (safeHead !== null) {
    const safe = blockNumber <= safeHead;
    return {
      confirmations,
      safe,
      waitingFor: safe ? null
        : `the batch containing it to reach Ethereum — about ${
            Math.max(1, Number(blockNumber - safeHead) * 2)} seconds`,
    };
  }

  const enough = confirmations >= min;
  return {
    confirmations,
    safe: enough,
    waitingFor: enough ? null : `${min - confirmations} more confirmations`,
  };
}

export async function finalityOf(blockNumber: bigint): Promise<Finality> {
  const [latest, safeHead] = await Promise.all([
    publicClient.getBlockNumber().catch(() => null),
    publicClient.getBlock({ blockTag: "safe" })
      .then((b) => (b?.number ?? null)).catch(() => null),
  ]);
  return finalityFrom({ blockNumber, latest, safeHead });
}

export type CreditResult =
  | { ok: true; depositId: string; token: StableToken; asset: string; amount: number;
      txHash: string; duplicate?: boolean;
      /** "credited" once the block is safe; "pending" while it is not. */
      state: "credited" | "pending";
      confirmations?: number; waitingFor?: string | null }
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
                             usdc_credited: string | null; status: string }[]>`
    select id::text, user_id::text, amount_tzs::text, usdc_credited::text, status
      from capx.deposits where lower(funding_tx) = ${txHash}`;
  if (seen) {
    if (seen.user_id !== input.userId) {
      return refuse("tx_already_used",
        "That transaction has already funded a different customer.", 409);
    }
    return { ok: true, depositId: seen.id, token: input.token, asset: spec.asset,
      amount: input.token === "USDC" ? Number(seen.usdc_credited ?? 0) : Number(seen.amount_tzs),
      txHash, duplicate: true,
      state: seen.status === "settled" ? "credited" : "pending" };
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
   * Safe yet?
   *
   * Asked after the amount is known, so a transfer that is mined but not yet
   * batched to Ethereum is recorded with everything it needs and simply not
   * credited. The row claims the hash either way, which is what stops the
   * same transaction being offered again while it waits.
   */
  const finality = await finalityOf(receipt.blockNumber);

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
            '', ${finality.safe ? "settled" : "pending"},
            ${finality.safe ? sql`now()` : null}, ${txHash},
            ${input.partnerId ?? null}, ${sql.json({
              route: "stablecoin-transfer", token: input.token, txHash,
              paymentMethod: "stablecoin_transfer",
              block: receipt.blockNumber.toString(),
            } as never)})
    returning id::text`;

  if (!finality.safe) {
    return { ok: true, depositId: row.id, token: input.token, asset: spec.asset, amount, txHash,
      state: "pending", confirmations: finality.confirmations, waitingFor: finality.waitingFor };
  }

  await record([{
    userId: input.userId, kind: "deposit", asset: spec.asset, amount: amount.toString(),
    ref: `deposit:${row.id}`,
    metadata: { route: "stablecoin-transfer", token: input.token, txHash },
  }]);

  return { ok: true, depositId: row.id, token: input.token, asset: spec.asset, amount, txHash,
    state: "credited", confirmations: finality.confirmations };
}

/**
 * Credits the transfers that were mined but not yet safe when they arrived.
 *
 * Runs on the scheduled tick. Everything it needs is already on the row — the
 * amount was read from the Transfer log at submission, so this re-checks
 * finality and nothing else, and the ledger write is keyed to the deposit id
 * exactly as the live path keys it. Running twice credits nobody twice.
 *
 * A transaction that has disappeared from the chain entirely — the case this
 * whole gate exists for — is marked failed rather than credited, and the desk
 * is told, because it means a reorg took money CAPX was about to hand over.
 */
export async function settleStablecoinDeposits(): Promise<{
  checked: number; credited: number; waiting: number; vanished: number;
}> {
  const out = { checked: 0, credited: 0, waiting: 0, vanished: 0 };
  await migrate();
  const sql = db();

  const rows = await sql<{ id: string; user_id: string; funding_tx: string;
                           amount_tzs: string; usdc_credited: string | null;
                           token: string | null }[]>`
    select id::text, user_id::text, funding_tx, amount_tzs::text, usdc_credited::text,
           metadata->>'token' as token
      from capx.deposits
     where status = 'pending' and funding_tx is not null
       and metadata->>'route' = 'stablecoin-transfer'
     order by created_at limit 50`;

  for (const r of rows) {
    out.checked++;
    const token: StableToken = r.token === "USDC" ? "USDC" : "NTZS";
    const asset = TOKEN[token].asset;
    const amount = token === "USDC" ? Number(r.usdc_credited ?? 0) : Number(r.amount_tzs);

    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: r.funding_tx as `0x${string}` });
    } catch {
      /*
       * Gone from the chain. It was mined when it was submitted, so this is
       * the reorg the gate was built for — the row stays claimed so the hash
       * cannot be reused, and a person is told.
       */
      await sql`update capx.deposits set status = 'failed',
                error = 'transaction no longer on chain — reorged before it was safe'
               where id = ${r.id}::uuid`;
      out.vanished++;
      const { sendMail } = await import("./mail");
      await sendMail({
        subject: "CAPX: a stablecoin deposit vanished before it was credited",
        text:
          `${amount} ${asset} was recorded against ${r.funding_tx} and that transaction can no ` +
          `longer be read on Base.\n\nNothing was credited, which is the gate working. The row ` +
          `is marked failed and keeps the hash so it cannot be resubmitted. If the sender ` +
          `believes it settled, check the hash before crediting anything by hand.`,
      }).catch(() => {});
      continue;
    }

    if (receipt.status !== "success") {
      await sql`update capx.deposits set status = 'failed',
                error = 'transaction reverted' where id = ${r.id}::uuid`;
      out.vanished++;
      continue;
    }

    const finality = await finalityOf(receipt.blockNumber);
    if (!finality.safe) { out.waiting++; continue; }

    await record([{
      userId: r.user_id, kind: "deposit", asset, amount: amount.toString(),
      ref: `deposit:${r.id}`,
      metadata: { route: "stablecoin-transfer", token, txHash: r.funding_tx },
    }]);
    await sql`update capx.deposits set status = 'settled', settled_at = now()
               where id = ${r.id}::uuid`;
    out.credited++;
  }

  return out;
}
