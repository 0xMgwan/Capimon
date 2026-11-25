import "server-only";

/**
 * The chain leg of a trade, after the ledger has already settled it.
 *
 * A customer's order settles in the ledger and is final the moment it is
 * written: the balance moves, the position is theirs, and nothing they can
 * see is waiting. That is the decision — ledger first, chain afterwards — and
 * it is the right way round, because a customer pressing buy should not be
 * waiting on a block, and a chain confirmation they never look at is a poor
 * reason to make them.
 *
 * What follows is this queue. A trade that moves tokens between custodians
 * gets a row, a worker sends it to SettlementEngine.settle(), and the hash
 * comes back onto the order. The ledger is the record; the chain is the
 * settlement of what the record says.
 *
 * ## Why most trades will not send anything
 *
 * Today a customer is a custodial claim with no address, and every maker's
 * tokens sit in a CAPX sub-account. A trade between them moves nothing
 * between custodians: the same party holds the token before and after, and
 * only the ledger's note of who it is held *for* has changed.
 *
 * Calling settle() on that would be CAPX transferring a token from one of its
 * own wallets to another, paying gas, and writing a transaction that proves
 * only that the omnibus paid itself. The daily anchor already commits every
 * trade's record to Base for a fraction of the cost, and a supervisor
 * following a chain of self-transfers learns less from it than from the
 * anchor. So an internal trade is marked settled-internally and sends
 * nothing.
 *
 * This is not a decision that has to be revisited when a bank maker arrives
 * with its own address. The same trade is then external, because one side is
 * genuinely somebody else's custody, and it dispatches. The classification is
 * read from who holds what, so onboarding a real counterparty changes the
 * answer without changing the code.
 */

import { db, dbConfigured, migrate } from "./db";

/**
 * Whether dispatch is switched on.
 *
 * Off by default, and that is deliberate rather than cautious filler.
 * Dispatching signs a transaction with the treasury key — the same key that
 * mints, prices and holds the float — and widening what that key is used for
 * is exactly the exposure the key-separation work exists to close. The queue
 * fills, the classification runs and the desk can see what would be sent, all
 * without that key being asked to do anything new. Turning this on is a
 * deliberate act after the signing split, not a side effect of deploying.
 */
export const dispatchEnabled = process.env.SETTLEMENT_DISPATCH === "on";

export type SettlementKind =
  /** Both sides in the same custody: the ledger is the whole settlement. */
  | "internal"
  /** Crosses a custody boundary, so the tokens have to actually move. */
  | "external";

export type SettlementStatus =
  | "internal" | "pending" | "sent" | "confirmed" | "failed" | "blocked";

/**
 * One side of a trade, as the chain sees it.
 *
 * The address is the *custodian's*, not the owner's, and the distinction is
 * the whole of this file's correctness. A custodial customer owns a claim and
 * holds no address; the tokens behind that claim sit in CAPX's omnibus. So
 * the party to a settlement is CAPX, acting for them — and a maker whose
 * tokens also sit in a CAPX sub-account is CAPX too.
 *
 * Modelling the owner instead gets this backwards twice over: it reports a
 * custodial customer as unable to settle, when their custodian settles
 * perfectly well on their behalf, and it reports a CAPX-held maker as a
 * separate party, when it is the same wallet on both sides of the trade.
 *
 * So `custodian` is null only when nothing holds the tokens, which is a
 * misconfiguration rather than a custody arrangement.
 */
export type Party = {
  /** The address that actually holds the tokens for this side. */
  custodian: string | null;
  canSettle: boolean;
  reason: string | null;
};

export type Classification = {
  kind: SettlementKind;
  status: SettlementStatus;
  /** Why it will not be sent, when it will not be. */
  reason: string | null;
};

/**
 * Whether a trade needs a transaction, and whether it can have one.
 *
 * Pure, because this is the judgement and everything around it is plumbing.
 * Three outcomes:
 *
 *   internal — nobody's custody changed. Nothing to send, and the ledger
 *              already settled it. Not a failure and not a deferral.
 *   pending  — custody changes and both parties can settle. Queue it.
 *   blocked  — custody changes and somebody cannot settle. This is the one
 *              that matters: a trade that *should* have moved tokens and
 *              cannot. It is recorded rather than dropped, because the
 *              ledger has already told a customer their position is theirs
 *              and the chain has not caught up.
 */
export function classify(buyer: Party, seller: Party): Classification {
  /*
   * One custodian on both sides means the tokens do not move.
   *
   * A single comparison, and it is the whole test. It covers today's trades —
   * a custodial customer buying from a CAPX-held maker, where the omnibus is
   * both the buyer's custodian and the seller's — without naming that case,
   * and it keeps covering it however many makers are onboarded into CAPX
   * custody. A bank maker holding its own tokens falls out the other side
   * because its address differs, not because anything here knows about banks.
   */
  const a = buyer.custodian?.toLowerCase() ?? null;
  const b = seller.custodian?.toLowerCase() ?? null;

  if (a && b && a === b) {
    return {
      kind: "internal",
      status: "internal",
      reason: "one custodian on both sides, so no tokens change hands",
    };
  }

  /* No custodian at all is not a custody arrangement, it is a gap: there is
     no wallet to send from or to, and the trade has already been settled in
     the ledger against tokens nothing is known to hold. */
  const missing = !a ? "buyer" : !b ? "seller" : null;
  if (missing) {
    return {
      kind: "external",
      status: "blocked",
      reason: `the ${missing} has no custodian address, so nothing can be transferred`,
    };
  }

  const unable = !buyer.canSettle ? { who: "buyer", p: buyer }
    : !seller.canSettle ? { who: "seller", p: seller }
    : null;

  if (unable) {
    return {
      kind: "external",
      status: "blocked",
      reason: `the ${unable.who} cannot settle: ${unable.p.reason ?? "not eligible"}`,
    };
  }

  return { kind: "external", status: "pending", reason: null };
}

/**
 * How many times a send is retried before it needs a person.
 *
 * A settlement is not a payment and nobody is waiting on it, so retrying
 * forever would be the wrong shape: it would hide a counterparty who has been
 * frozen, or a contract that is paused, behind an endless queue. Five
 * attempts and then the desk hears.
 */
export const MAX_ATTEMPTS = 5;

/** Backoff between attempts, in minutes, by attempt number. */
export const BACKOFF_MIN = [1, 5, 15, 60, 240];

export const nextAttemptAfter = (attempts: number): number =>
  BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)] * 60_000;

export type QueueRow = {
  orderId: string;
  symbol: string;
  qty: number;
  kind: SettlementKind;
  status: SettlementStatus;
  buyer: string | null;
  seller: string | null;
  reason: string | null;
};

/**
 * Records what a settled trade implies for the chain.
 *
 * Called after the ledger has written the trade, never before and never
 * inside its transaction: the ledger entry is the thing that makes the trade
 * real, and a chain classification failing must not be able to undo it. Every
 * trade gets a row, including the internal ones that will never be sent —
 * a settlement history with the no-op trades missing would read as a gap
 * rather than as an answer.
 *
 * Keyed on the order, so a retry of the same order writes nothing new.
 */
export async function enqueueSettlement(args: {
  orderId: string;
  symbol: string;
  qty: number;
  buyer: Party;
  seller: Party;
}): Promise<Classification | null> {
  if (!dbConfigured) return null;
  const { kind, status, reason } = classify(args.buyer, args.seller);

  await migrate();
  await db()`
    insert into capx.settlements
      (order_id, symbol, qty, kind, status, buyer_address, seller_address, reason)
    values (${args.orderId}::uuid, ${args.symbol}, ${args.qty}, ${kind}, ${status},
            ${args.buyer.custodian}, ${args.seller.custodian}, ${reason})
    on conflict (order_id) do nothing`;

  return { kind, status, reason };
}

/** What the desk needs to know about the chain leg, in one read. */
export async function settlementHealth(): Promise<{
  internal: number; pending: number; sent: number;
  confirmed: number; failed: number; blocked: number;
  oldestPending: string | null;
  dispatchEnabled: boolean;
} | null> {
  if (!dbConfigured) return null;
  await migrate();
  const [row] = await db()<{
    internal: number; pending: number; sent: number; confirmed: number;
    failed: number; blocked: number; oldest: string | null;
  }[]>`
    select count(*) filter (where status = 'internal')::int  as internal,
           count(*) filter (where status = 'pending')::int   as pending,
           count(*) filter (where status = 'sent')::int      as sent,
           count(*) filter (where status = 'confirmed')::int as confirmed,
           count(*) filter (where status = 'failed')::int    as failed,
           count(*) filter (where status = 'blocked')::int   as blocked,
           min(created_at) filter (where status = 'pending')::text as oldest
      from capx.settlements`;
  return row
    ? { internal: row.internal, pending: row.pending, sent: row.sent,
        confirmed: row.confirmed, failed: row.failed, blocked: row.blocked,
        oldestPending: row.oldest, dispatchEnabled }
    : null;
}
