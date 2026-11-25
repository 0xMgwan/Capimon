import "server-only";
import { createHash } from "node:crypto";
import { db, migrate } from "./db";
import { dseSecurities } from "./dseSecurities";

/**
 * The day's trades, hashed into one number, written to Base.
 *
 * CAPX's DSE book settles internally: a customer buying CRDB moves shares
 * that stay in the omnibus wallet the whole time, so there is no chain
 * transaction per trade and there should not be one — a transfer that moves
 * nothing between wallets costs gas to say nothing, and a supervisor who
 * followed it would find the omnibus paying itself.
 *
 * What a supervisor actually needs is narrower and gettable: an assurance
 * that the trades they are reading today are the trades that existed on the
 * day they happened. That is one number a day.
 *
 * Each trade hashes to a leaf, the day's leaves hash pairwise into a root,
 * and the root is written into the calldata of one transaction from the
 * treasury to itself. From then on the day is fixed. Re-deriving the root
 * from the book is a comparison anyone can do, and the chain holds the
 * number CAPX cannot go back and change — so a mismatch is not CAPX's word
 * against DSE's, it is arithmetic.
 *
 * What this is not: it does not prove a trade was good, or priced fairly, or
 * that the shares existed. It proves the record has not moved since. That is
 * the one thing a book kept by the party being supervised cannot otherwise
 * establish about itself.
 */

/** Tanzania is UTC+3 all year, so the offset is exact and needs no timezone database. */
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

const asDate = (v: unknown): Date =>
  v instanceof Date ? v : new Date(String(v ?? ""));

/**
 * The trading day a moment belongs to, as Dar es Salaam keeps it.
 *
 * UTC would have been easier and wrong. An order placed at half past midnight
 * in Dar is 21:30 the previous day in UTC, so a UTC day cuts the exchange's
 * own day in two and files the two halves apart. Every date this module
 * produces — the day a reference carries, the day an anchor covers — is this
 * one, so they always agree.
 */
export function eatDay(at: unknown): string {
  const d = asDate(at);
  if (Number.isNaN(d.getTime())) return "1970-01-01";
  const shifted = new Date(d.getTime() + EAT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** The UTC instants an EAT day begins and ends, for querying. */
export function eatDayBounds(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00.000Z`).getTime() - EAT_OFFSET_MS;
  return { from: new Date(from), to: new Date(from + 24 * 60 * 60 * 1000) };
}

/** Yesterday in Dar, which is the day that has just closed. */
export function previousEatDay(now: Date = new Date()): string {
  return eatDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

const stamp = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? "" : String(v);

/**
 * What a trade is, reduced to one line.
 *
 * Every field that decides what the trade *was* is in here and nothing that
 * does not: who placed it is deliberately absent, because the anchor is
 * posted in public and a leaf nobody can link to a person is the only kind
 * worth publishing. The order id is in it, so two identical trades still
 * hash apart.
 *
 * The numbers are the database's own text, not a formatted version of it.
 * Formatting is a decision, decisions change, and a leaf that moved because
 * somebody changed how a price is displayed would be a false alarm forever.
 */
export type TradeRow = {
  id: string; side: string; symbol: string;
  qty: string | null; price: string | null; cash: string | null;
  status: string; created_at: unknown; settled_at: unknown;
};

export function canonicalTrade(o: TradeRow): string {
  return [o.id, o.side, o.symbol.toUpperCase(), o.qty ?? "", o.price ?? "",
          o.cash ?? "", o.status, stamp(o.settled_at)].join("|");
}

/** The trade's leaf: SHA-256 of its canonical line, as 64 lowercase hex. */
export function tradeLeaf(o: TradeRow): string {
  return createHash("sha256").update(canonicalTrade(o), "utf8").digest("hex");
}

/**
 * The reference a trade is quoted by, which is the front of its own leaf.
 *
 * `CRDB-261124-7F3A9C2E` reads as a contract note and is deliberately not
 * shaped like a transaction hash, so nobody pastes it into a block explorer
 * and concludes CAPX invented it. The last part is the first four bytes of
 * the leaf, which is the useful bit: somebody holding a reference can find
 * their trade in the day's manifest without being handed a second identifier
 * to keep track of.
 *
 * Derived rather than assigned, so CAPX cannot renumber a trade, and a
 * figure altered after DSE wrote the reference down no longer produces it.
 */
export function dealRef(o: TradeRow): string {
  const sec = o.symbol.toUpperCase();
  const day = eatDay(o.created_at).slice(2).replace(/-/g, "");
  return `${sec}-${day}-${tradeLeaf(o).slice(0, 8).toUpperCase()}`;
}

/**
 * The root of a day's leaves.
 *
 * Sorted first, so the root does not depend on the order rows came back in —
 * two readers querying the same day with different `order by` clauses must
 * reach the same number or the whole thing is worthless. An odd leaf at any
 * level is carried up rather than paired with a copy of itself: duplicating
 * it is the classic construction and the classic construction is where the
 * Bitcoin duplicate-transaction flaw came from, so this avoids it.
 *
 * Zero trades has a root of all zeroes and is still anchored. A day on which
 * nothing traded is a fact about the day, and leaving a gap in the chain of
 * anchors would make "no trades" and "no anchor posted" look identical.
 */
export const EMPTY_ROOT = "0".repeat(64);

export function merkleRoot(leaves: readonly string[]): string {
  if (leaves.length === 0) return EMPTY_ROOT;

  /* Hex in, hex out, with the bytes assembled only to be hashed. Pairing is
     over the 32 raw bytes of each child, not over their hex text — the two
     are different trees and only one of them is what everyone else means by
     a Merkle root. */
  let level: string[] = [...leaves].sort();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length
        ? createHash("sha256")
            .update(Buffer.from(level[i] + level[i + 1], "hex")).digest("hex")
        : level[i]);
    }
    level = next;
  }
  return level[0];
}

/**
 * The line that goes onchain.
 *
 * Plain UTF-8 rather than an encoded struct, because the reader this is for
 * is a supervisor opening a block explorer, not an indexer. Basescan will
 * show the calldata as text, and the text says what it is, which day it
 * covers, how many trades are in it and what the root is — enough to check
 * against the portal without being told how to decode anything first.
 *
 * No contract, for the same reason. A contract would be nicer to index and
 * would also be a thing CAPX deployed, could upgrade, and would have to be
 * trusted not to have. Calldata on a transaction from a known address is
 * inert: there is nothing to audit but the bytes.
 */
export const ANCHOR_TAG = "CAPX.DSE.ANCHOR.v1";

export function anchorPayload(day: string, trades: number, root: string): `0x${string}` {
  const line = `${ANCHOR_TAG} ${day} trades=${trades} root=${root}`;
  return `0x${Buffer.from(line, "utf8").toString("hex")}`;
}

/* ------------------------------------------------------------------ */

/** The DSE symbols, upper-cased, as the rest of the portal scopes by. */
async function dseSymbols(): Promise<string[]> {
  const listed = await dseSecurities();
  return listed.map((s) => s.symbol.toUpperCase());
}

/**
 * The settled trades of one EAT day, in the exact form they are hashed in.
 *
 * Settled only, and dated by settlement rather than by placement. Both
 * choices are about the leaf never moving after the fact: a pending order
 * has a status that is going to change, and an order placed late on Monday
 * that settles on Tuesday belongs to the day its terms became final. A leaf
 * that could still change is not an anchor, it is a promise.
 */
export async function tradesOn(day: string): Promise<TradeRow[]> {
  await migrate();
  const sql = db();
  const symbols = await dseSymbols();
  if (!symbols.length) return [];
  const { from, to } = eatDayBounds(day);

  return sql<TradeRow[]>`
    select o.id::text, o.side, o.symbol, o.qty::text, o.price::text,
           (select abs(l.amount)::text from capx.ledger_entries l
             where l.ref = o.id::text || ':cash' and l.asset = 'TZS' limit 1) as cash,
           o.status, o.created_at, o.settled_at
      from capx.orders o
     where upper(o.symbol) = any(${symbols})
       and o.status = 'settled'
       and o.settled_at >= ${from} and o.settled_at < ${to}
     order by o.settled_at`;
}

/** What the book says the day's root is, right now. */
export async function rootOn(day: string) {
  const trades = await tradesOn(day);
  const leaves = trades.map(tradeLeaf);
  return { trades, leaves, root: merkleRoot(leaves), count: trades.length };
}

/**
 * The day's trades with their leaves, for somebody re-deriving the root.
 *
 * An anchor nobody can recompute is decoration. This hands over the exact
 * canonical line behind each leaf, so checking CAPX's claim needs a SHA-256
 * implementation and nothing else — not our code, not our database, and not
 * our word for how a number was formatted.
 */
export async function manifest(day: string) {
  const { trades, root, count } = await rootOn(day);
  const [posted] = await db()<{ root: string; tx_hash: string | null; status: string }[]>`
    select root, tx_hash, status from capx.dse_anchors where day = ${day}::date`;

  return {
    day, count, root,
    anchored: posted ? { root: posted.root, txHash: posted.tx_hash, status: posted.status } : null,
    matches: posted ? posted.root === root : null,
    trades: trades.map((t) => ({
      reference: dealRef(t), leaf: tradeLeaf(t), canonical: canonicalTrade(t),
      id: t.id, side: t.side, security: t.symbol.toUpperCase(),
      qty: t.qty, price: t.price, cash: t.cash,
      status: t.status, settledAt: stamp(t.settled_at),
    })),
  };
}

/* ------------------------------------------------------------------ */

export type AnchorRow = {
  day: string; root: string; trades: number; txHash: string | null;
  status: string; error: string | null; postedAt: string | null; createdAt: string;
  /** The root the book gives today, and whether it still agrees. */
  liveRoot: string; liveTrades: number; matches: boolean;
};

/**
 * Every anchor, each checked against the book as it stands now.
 *
 * The comparison is the feature. Storing the leaves alongside the root would
 * have made this cheaper and pointless: re-deriving from the live rows is
 * the only version that notices when a live row has changed.
 */
export async function anchors(limit = 60): Promise<AnchorRow[]> {
  await migrate();
  const sql = db();
  const rows = await sql<{ day: string; root: string; trades: number; tx_hash: string | null;
                           status: string; error: string | null; posted_at: string | null;
                           created_at: string }[]>`
    select to_char(day, 'YYYY-MM-DD') as day, root, trades, tx_hash, status, error,
           posted_at, created_at
      from capx.dse_anchors order by day desc limit ${limit}`;

  return Promise.all(rows.map(async (r) => {
    const live = await rootOn(r.day);
    return {
      day: r.day, root: r.root, trades: Number(r.trades), txHash: r.tx_hash,
      status: r.status, error: r.error, postedAt: r.posted_at, createdAt: r.created_at,
      liveRoot: live.root, liveTrades: live.count,
      /* An anchor that never reached the chain has nothing to disagree with,
         so it is not called a match either way. */
      matches: r.status === "posted" && live.root === r.root,
    };
  }));
}

/* ------------------------------------------------------------------ */

export type AnchorResult =
  | { ok: true; day: string; root: string; trades: number; txHash: string; already?: false }
  | { ok: true; day: string; root: string; trades: number; txHash: string | null; already: true }
  | { ok: false; day: string; error: string };

/**
 * Anchor one day, once.
 *
 * The row is written before the transaction is sent and carries the root from
 * that moment, so a send that fails leaves a record of what was meant to go
 * out rather than nothing at all. A day already posted is never posted again:
 * two roots for one day would turn the thing this exists to settle into an
 * argument about which transaction counts.
 */
export async function anchorDay(day: string): Promise<AnchorResult> {
  await migrate();
  const sql = db();

  const [existing] = await sql<{ root: string; status: string; tx_hash: string | null;
                                 trades: number }[]>`
    select root, status, tx_hash, trades from capx.dse_anchors where day = ${day}::date`;
  if (existing && existing.status === "posted") {
    return { ok: true, already: true, day, root: existing.root,
             trades: Number(existing.trades), txHash: existing.tx_hash };
  }

  const { root, count } = await rootOn(day);

  /* Written first, so a failed send leaves evidence it was attempted. On a
     retry the root is recomputed and overwritten, which is right while
     nothing has been posted and impossible once something has. */
  await sql`
    insert into capx.dse_anchors (day, root, trades, status)
    values (${day}::date, ${root}, ${count}, 'pending')
    on conflict (day) do update
      set root = excluded.root, trades = excluded.trades,
          status = 'pending', error = null`;

  const { treasuryConfigured, treasurySend, treasuryDiagnosis } = await import("./treasury");
  if (!treasuryConfigured) {
    const why = treasuryDiagnosis() ?? "the treasury signer is not configured";
    await sql`update capx.dse_anchors set status = 'failed', error = ${why}
               where day = ${day}::date`;
    return { ok: false, day, error: why };
  }

  try {
    const txHash = await treasurySend({ data: anchorPayload(day, count, root) });
    await sql`
      update capx.dse_anchors
         set tx_hash = ${txHash}, status = 'posted', posted_at = now(), error = null
       where day = ${day}::date`;
    return { ok: true, day, root, trades: count, txHash };
  } catch (e) {
    const why = e instanceof Error ? e.message : "the anchor transaction failed";
    await sql`update capx.dse_anchors set status = 'failed', error = ${why}
               where day = ${day}::date`;
    return { ok: false, day, error: why };
  }
}

/**
 * Catch up on whatever has not been anchored, newest day first.
 *
 * A cron that only ever anchors yesterday loses any day it was not run on,
 * permanently, because the day it missed is in the past and nothing will
 * come back for it. This walks back over the window and posts what is
 * missing, so one bad night costs a late anchor rather than a hole.
 */
export async function anchorBacklog(days = 7): Promise<AnchorResult[]> {
  const out: AnchorResult[] = [];
  const today = eatDay(new Date());
  for (let i = 1; i <= days; i++) {
    const day = eatDay(new Date(new Date(`${today}T12:00:00.000Z`).getTime() - i * 86_400_000));
    const result = await anchorDay(day);
    if (!("already" in result) || !result.already) out.push(result);
    if (!result.ok) break; /* Something is wrong; do not burn gas on six more. */
  }
  return out;
}
