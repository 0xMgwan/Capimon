import "server-only";
import { formatUnits, parseUnits } from "viem";
import { db, dbConfigured, migrate } from "./db";
import { publicClient } from "./chain";
import { b20Abi } from "./abis";
import { USDC_BASE } from "./assets";
import { FEE_BPS } from "./fees";
import { treasuryAddress, treasuryWrite } from "./treasury";
import { dseSecurities, type DseSecurity } from "./dseSecurities";
import { readOraclePrice } from "./oracle";
import { backing } from "./custody";

/**
 * Selling a tokenised share to somebody's own wallet, and buying it back.
 *
 * There is no pool in these securities and there does not need to be: CAPX is
 * the counterparty, the way it already is for a customer holding in the app.
 * The difference is only where the share ends up — a ledger row, or an address
 * the customer holds the keys to.
 *
 * The price is the same two numbers the custodial ticket uses: the DSE close
 * the oracle carries, converted at the nTZS rate. A share must not cost one
 * thing in the app and another on-chain, so neither figure is derived here.
 *
 * ## What is sold
 *
 * Only the unallocated slice. Every token the treasury holds is backed by
 * FIMCO's pledge, but some of it already answers for a custodial customer's
 * claim, and selling that would be selling the same share twice. `available()`
 * subtracts both those claims and any order still holding a reservation.
 *
 * ## How money moves
 *
 * In two legs, deliberately not simultaneous. The customer pays first, from
 * the address they verified, and CAPX sends only against a mined receipt it
 * has read itself — never against a client's word that it paid. `funding_tx`
 * is unique in the table, so the same receipt settles once however many times
 * it is presented.
 *
 * ## What this does not do
 *
 * It checks who CAPX sells to. It does not follow the share afterwards.
 * Whether a holder can pass it on to an address CAPX never verified is a
 * property of the token, not of this file — if that has to be prevented, it
 * has to be prevented in the token's own transfer policy.
 */

/** How long a quote is good for. Long enough to sign, short enough to mean it. */
const QUOTE_MINUTES = 15;

/**
 * The most one order may move, in USDC.
 *
 * Not a view about how much anybody should invest — a bound on how much a bug
 * in any of this can cost before somebody notices. Raise it deliberately.
 */
const MAX_ORDER_USDC = Number(process.env.OTC_MAX_ORDER_USDC ?? 500);

export type OtcQuote = {
  reference: string;
  security: string;
  side: "buy" | "sell";
  qty: number;
  priceTzs: number;
  usdPerTzs: number;
  /** What the customer sends (buy) or receives (sell). */
  netUsdc: number;
  feeUsdc: number;
  /** Where to send the funding leg. */
  payTo: `0x${string}`;
  payToken: `0x${string}`;
  payDecimals: number;
  /** The exact amount to transfer, in the pay token's own units. */
  payAmount: string;
  expiresAt: string;
};

export type OtcOrder = {
  reference: string;
  security: string;
  side: "buy" | "sell";
  qty: number;
  netUsdc: number;
  feeUsdc: number;
  status: string;
  fundingTx: string | null;
  settleTx: string | null;
  failure: string | null;
  createdAt: string;
  settledAt: string | null;
};

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

async function security(symbol: string): Promise<DseSecurity> {
  const list = await dseSecurities();
  const sec = list.find((s) => s.symbol === symbol.toUpperCase());
  if (!sec) throw new Error(`${symbol} is not a listed security.`);
  if (sec.status !== "live") throw new Error(`${sec.symbol} is not open for trading.`);
  return sec;
}

/** The DSE mark and the shilling rate, fetched together. */
async function pricing(symbol: string): Promise<{ priceTzs: number; usdPerTzs: number }> {
  const { getSwapRate, ntzsConfigured } = await import("./ntzs");
  const [mark, rate] = await Promise.all([
    readOraclePrice(symbol).catch(() => null),
    ntzsConfigured
      ? getSwapRate("NTZS", "USDC", 100_000)
          .then((r) => { const out = Number(r.expectedOutput ?? 0); return out > 0 ? out / 100_000 : 0; })
          .catch(() => 0)
      : 0,
  ]);
  const priceTzs = mark?.price ?? 0;
  if (!(priceTzs > 0)) throw new Error(`No published price for ${symbol} right now.`);
  if (!(rate > 0)) throw new Error("The shilling rate is unavailable right now. Try again shortly.");
  return { priceTzs, usdPerTzs: rate };
}

/** What the treasury can actually put its hands on, in shares. */
async function treasuryBalance(sec: DseSecurity): Promise<number> {
  const treasury = treasuryAddress();
  if (!treasury) return 0;
  const raw = await publicClient.readContract({
    address: sec.token, abi: b20Abi, functionName: "balanceOf", args: [treasury],
  });
  return Number(formatUnits(raw as bigint, sec.decimals));
}

/**
 * Shares that may be sold into self-custody right now.
 *
 * Three subtractions, and the first one is the easy one to get wrong.
 *
 * Unallocated supply — issued less what custodial customers are owed — is the
 * right ceiling on what CAPX may sell, but it is not a statement about what
 * CAPX can send. Once a share is in somebody's wallet, total supply is
 * unchanged while the treasury's balance has fallen, so unallocated keeps
 * reporting the whole float long after half of it has left. Selling against
 * that figure would promise shares the treasury no longer holds.
 *
 * So the real constraint is the balance in hand, less the custodial claims it
 * has to keep answering for, and the ceiling is whichever of the two binds.
 * Then less anything an open quote has already spoken for, because two people
 * quoting at once must not both be promised the last share.
 */
export async function available(symbol: string): Promise<number> {
  const sym = symbol.toUpperCase();
  const sec = await dseSecurities().then((l) => l.find((x) => x.symbol === sym));
  if (!sec) return 0;

  const [b, held, reserved] = await Promise.all([
    backing(sym),
    treasuryBalance(sec).catch(() => 0),
    dbConfigured
      ? migrate().then(() => db()<{ qty: string }[]>`
          select coalesce(sum(qty), 0)::text as qty from capx.otc_orders
           where security = ${sym} and side = 'buy'
             and (status = 'funded' or (status = 'quoted' and expires_at > now()))`)
          .then((r) => Number(r[0]?.qty ?? 0))
      : 0,
  ]);

  const sendable = held - b.clientHeld;
  return Math.max(0, Math.min(b.unallocated, sendable) - reserved);
}

/**
 * Prices an order and holds the inventory for it.
 *
 * A buy is quoted from the USDC the customer wants to spend; a sell from the
 * shares they want to give up. That is the way round each side actually thinks
 * about it, and it is what the custodial ticket already asks for.
 */
export async function quote(input: {
  userId: string;
  address: string;
  security: string;
  side: "buy" | "sell";
  /** USDC for a buy, shares for a sell. */
  amount: number;
}): Promise<OtcQuote> {
  const sec = await security(input.security);
  if (input.side === "sell" && sec.buyOnly) {
    throw new Error(`${sec.symbol} cannot be sold back yet.`);
  }
  const treasury = treasuryAddress();
  if (!treasury) throw new Error("The treasury is not configured on this deployment.");
  if (!(input.amount > 0)) throw new Error("Enter an amount.");

  const { priceTzs, usdPerTzs } = await pricing(sec.symbol);
  const usdPerShare = priceTzs * usdPerTzs;
  const feeRate = FEE_BPS / 10_000;

  let qty: number, grossUsdc: number, feeUsdc: number, netUsdc: number;
  if (input.side === "buy") {
    // The fee comes out of what they send, so the amount they type is the
    // amount that leaves their wallet — no surprise second charge.
    netUsdc = round(input.amount, 6);
    feeUsdc = round(netUsdc * feeRate, 6);
    grossUsdc = round(netUsdc - feeUsdc, 6);
    qty = round(grossUsdc / usdPerShare, 8);
  } else {
    qty = round(input.amount, 8);
    grossUsdc = round(qty * usdPerShare, 6);
    feeUsdc = round(grossUsdc * feeRate, 6);
    netUsdc = round(grossUsdc - feeUsdc, 6);
  }

  if (!(qty > 0) || !(netUsdc > 0)) throw new Error("That amount is too small to trade.");
  if (netUsdc > MAX_ORDER_USDC) {
    throw new Error(`One order is capped at ${MAX_ORDER_USDC} USDC. Split it, or ask the desk.`);
  }

  if (input.side === "buy") {
    const free = await available(sec.symbol);
    if (qty > free) {
      throw new Error(
        `Only ${free.toFixed(4)} ${sec.symbol} is available to self-custody right now. ` +
        `More needs a fresh custody attestation.`,
      );
    }
  } else {
    /*
     * Refuse a sell CAPX cannot pay for, at quote time rather than after the
     * shares have arrived. There is no escrow here: the customer sends first,
     * and discovering the treasury is short *after* that would leave them
     * holding nothing while we hold their shares.
     */
    const { sweepableUsdc } = await import("./ntzsFunding");
    const onHand = Number(formatUnits(
      (await publicClient.readContract({
        address: USDC_BASE, abi: b20Abi, functionName: "balanceOf", args: [treasury],
      })) as bigint, 6));
    const reachable = onHand + await sweepableUsdc().catch(() => 0);
    if (reachable < netUsdc) {
      throw new Error(
        `CAPX can reach ${reachable.toFixed(2)} USDC and this sale needs ${netUsdc.toFixed(2)}. ` +
        `Try a smaller size, or sell into your CAPX balance instead.`,
      );
    }
  }

  const reference = `OTC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await migrate();
  await db()`
    insert into capx.otc_orders
      (reference, user_id, address, security, side, qty, price_tzs, usd_per_tzs,
       gross_usdc, fee_usdc, net_usdc, expires_at)
    values (${reference}, ${input.userId}::uuid, ${input.address.toLowerCase()}, ${sec.symbol},
            ${input.side}, ${qty}, ${priceTzs}, ${usdPerTzs}, ${grossUsdc}, ${feeUsdc}, ${netUsdc},
            now() + make_interval(mins => ${QUOTE_MINUTES}))`;

  // The funding leg: USDC for a buy, the share token itself for a sell.
  const payToken = input.side === "buy" ? USDC_BASE : sec.token;
  const payDecimals = input.side === "buy" ? 6 : sec.decimals;
  const payAmount = input.side === "buy"
    ? parseUnits(netUsdc.toFixed(6), 6).toString()
    : parseUnits(qty.toFixed(sec.decimals), sec.decimals).toString();

  return {
    reference, security: sec.symbol, side: input.side, qty, priceTzs, usdPerTzs,
    netUsdc, feeUsdc, payTo: treasury, payToken, payDecimals, payAmount,
    expiresAt: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(),
  };
}

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const topicAddress = (topic: string | undefined) =>
  topic ? `0x${topic.slice(26)}`.toLowerCase() : "";

/**
 * Settles an order against the customer's funding transaction.
 *
 * Everything is re-read from the chain. The client supplies a hash and nothing
 * else that matters: which token moved, from whom, to whom and how much all
 * come out of the receipt, because a client that can name its own payment
 * amount can name a larger one.
 */
export async function settle(input: {
  userId: string;
  reference: string;
  txHash: string;
}): Promise<{ ok: true; order: OtcOrder } | { ok: false; error: string }> {
  await migrate();
  const sql = db();
  const hash = input.txHash.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return { ok: false, error: "That is not a transaction hash." };

  const [order] = await sql<{
    id: string; address: string; security: string; side: string; qty: string;
    net_usdc: string; fee_usdc: string; usd_per_tzs: string; status: string; expired: boolean;
  }[]>`
    select id::text, address, security, side, qty::text, net_usdc::text, fee_usdc::text,
           usd_per_tzs::text, status, (expires_at < now()) as expired
      from capx.otc_orders
     where reference = ${input.reference} and user_id = ${input.userId}::uuid`;
  if (!order) return { ok: false, error: "No such order." };
  if (order.status === "settled") return { ok: false, error: "That order has already settled." };
  if (order.status === "failed") {
    return { ok: false, error: "That order failed and is with the desk. Do not send again." };
  }

  const sec = await security(order.security);
  const side = order.side === "sell" ? "sell" : "buy";
  const qty = Number(order.qty);
  const netUsdc = Number(order.net_usdc);
  const treasury = treasuryAddress();
  if (!treasury) return { ok: false, error: "The treasury is not configured." };

  /*
   * Claim the receipt before reading it.
   *
   * The unique index on funding_tx is what stops the same payment settling two
   * orders, and claiming it here — rather than after the transfer — means two
   * requests racing on one hash cannot both reach the send.
   */
  const claimed = await sql`
    update capx.otc_orders set funding_tx = ${hash}, status = 'funded'
     where id = ${order.id}::uuid and status = 'quoted'
    returning id`.catch(() => [] as { id: string }[]);
  if (!claimed.length) {
    return { ok: false, error: "That payment has already been used, or the order is no longer open." };
  }

  const fail = async (reason: string) => {
    await sql`update capx.otc_orders set status = 'failed', failure = ${reason} where id = ${order.id}::uuid`;
    /*
     * A failure here means CAPX may be holding money it has not delivered
     * against. That is not something to leave in a status column — the desk
     * is told the moment it happens.
     */
    const { sendMail } = await import("./mail");
    await sendMail({
      subject: `CAPX: self-custody order ${input.reference} needs attention`,
      text:
        `Order ${input.reference} (${side} ${qty} ${order.security}) was funded by ${hash} ` +
        `but could not be settled.\n\nReason: ${reason}\n\n` +
        `The customer's funds are with CAPX and nothing has been sent to them. ` +
        `Resolve manually and mark the order.`,
    }).catch(() => { /* the row still records it */ });
    return { ok: false as const, error: "Your payment arrived but the transfer failed. The desk has been told and will settle it." };
  };

  const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` }).catch(() => null);
  if (!receipt) {
    // Not yet mined is not a failure — let them present it again.
    await sql`update capx.otc_orders set funding_tx = null, status = 'quoted' where id = ${order.id}::uuid`;
    return { ok: false, error: "That transaction has not been mined yet. Try again in a moment." };
  }
  if (receipt.status !== "success") {
    await sql`update capx.otc_orders set funding_tx = null, status = 'quoted' where id = ${order.id}::uuid`;
    return { ok: false, error: "That transaction reverted. Nothing was paid." };
  }

  // What the payment actually was, read from its own logs.
  const expectToken = (side === "buy" ? USDC_BASE : sec.token).toLowerCase();
  const expectDecimals = side === "buy" ? 6 : sec.decimals;
  const expectAmount = side === "buy" ? netUsdc : qty;

  let paid = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== expectToken) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (topicAddress(log.topics[1]) !== order.address.toLowerCase()) continue;
    if (topicAddress(log.topics[2]) !== treasury.toLowerCase()) continue;
    paid += BigInt(log.data);
  }
  const paidAmount = Number(formatUnits(paid, expectDecimals));

  // A rounding-width tolerance, not a discount: enough to absorb the last
  // decimal place, far too little to underpay with.
  if (paidAmount + 1e-6 < expectAmount) {
    await sql`update capx.otc_orders set funding_tx = null, status = 'quoted' where id = ${order.id}::uuid`;
    return {
      ok: false,
      error: paid === 0n
        ? "That transaction did not pay CAPX from the address on this order."
        : `That paid ${paidAmount} and the order is for ${expectAmount}.`,
    };
  }

  /*
   * A lapsed quote is honoured, not refused.
   *
   * Somebody who paid a second after their fifteen minutes has parted with
   * real money against a price CAPX published, and turning them away leaves
   * us holding it. Honouring it costs us the price move, which is the right
   * way round to be wrong — so expiry is deliberately not checked here.
   *
   * What is checked is that the share is still there to send. An expired
   * quote has released its reservation, so a late payment can arrive after
   * the inventory went to somebody else, and sending anyway would dip into
   * the shares that answer for custodial customers.
   */
  try {
    if (side === "buy") {
      const [held, b] = await Promise.all([
        treasuryBalance(sec),
        backing(sec.symbol),
      ]);
      if (held - b.clientHeld + 1e-8 < qty) {
        return await fail(
          `Inventory moved before this settled: the treasury holds ${held} ${sec.symbol} with ` +
          `${b.clientHeld} owed to custodial customers, and this order is for ${qty}.`,
        );
      }
      const raw = parseUnits(qty.toFixed(sec.decimals), sec.decimals);
      const txHash = await treasuryWrite({
        address: sec.token, abi: b20Abi, functionName: "transfer", args: [order.address, raw],
      });
      const sent = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (sent.status !== "success") return await fail(`Share transfer ${txHash} reverted.`);
      await sql`
        update capx.otc_orders set status = 'settled', settle_tx = ${txHash}, settled_at = now()
         where id = ${order.id}::uuid`;
    } else {
      const { ensureTreasuryFunded } = await import("./treasury");
      await ensureTreasuryFunded(netUsdc, treasury);
      const raw = parseUnits(netUsdc.toFixed(6), 6);
      const txHash = await treasuryWrite({
        address: USDC_BASE, abi: b20Abi, functionName: "transfer", args: [order.address, raw],
      });
      const sent = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (sent.status !== "success") return await fail(`USDC payout ${txHash} reverted.`);
      await sql`
        update capx.otc_orders set status = 'settled', settle_tx = ${txHash}, settled_at = now()
         where id = ${order.id}::uuid`;
    }
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "The transfer failed.");
  }

  /*
   * The broker's cut, in shillings, on the same terms as a custodial trade.
   * FIMCO tokenised the share; where it ends up does not change that.
   */
  const feeTzs = Number(order.fee_usdc) / Number(order.usd_per_tzs);
  if (feeTzs > 0) {
    const { accrueBrokerFee } = await import("./brokerLedger");
    await accrueBrokerFee({ orderId: order.id, security: order.security, fee: feeTzs })
      .catch(() => { /* the trade stands; the accrual is reconcilable */ });
  }

  const [done] = await listOrders(input.userId, input.reference);
  return { ok: true, order: done };
}

/** This account's self-custody orders, newest first. */
export async function listOrders(userId: string, reference?: string): Promise<OtcOrder[]> {
  if (!dbConfigured) return [];
  await migrate();
  const rows = await db()<{
    reference: string; security: string; side: string; qty: string; net_usdc: string;
    fee_usdc: string; status: string; funding_tx: string | null; settle_tx: string | null;
    failure: string | null; created_at: string; settled_at: string | null;
  }[]>`
    select reference, security, side, qty::text, net_usdc::text, fee_usdc::text, status,
           funding_tx, settle_tx, failure, created_at, settled_at
      from capx.otc_orders
     where user_id = ${userId}::uuid
       ${reference ? db()`and reference = ${reference}` : db()``}
     order by created_at desc
     limit 25`;
  return rows.map((r) => ({
    reference: r.reference, security: r.security,
    side: r.side === "sell" ? "sell" : "buy",
    qty: Number(r.qty), netUsdc: Number(r.net_usdc), feeUsdc: Number(r.fee_usdc),
    status: r.status, fundingTx: r.funding_tx, settleTx: r.settle_tx, failure: r.failure,
    createdAt: r.created_at, settledAt: r.settled_at,
  }));
}

/** Lets a lapsed quote release its inventory. Called from the cron tick. */
export async function expireStaleQuotes(): Promise<number> {
  if (!dbConfigured) return 0;
  await migrate();
  const rows = await db()`
    update capx.otc_orders set status = 'expired'
     where status = 'quoted' and expires_at < now() - interval '5 minutes'
    returning id`;
  return rows.length;
}
