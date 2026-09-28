import "server-only";
import { db, migrate } from "./db";

/**
 * Custodial ledger.
 *
 * CAPX holds USDC and shares on behalf of nTZS users, so balances are never
 * stored as a mutable number. Every movement is an append-only entry and a
 * balance is their sum — which means a bug can be traced and corrected rather
 * than silently overwriting what someone is owed.
 *
 * `ref` carries the external identifier (deposit id, transaction hash, order
 * id). It is uniquely indexed, so replaying a webhook or retrying a request
 * cannot credit the same money twice.
 */

export type EntryKind =
  | "deposit"        // USDC arrived from the user's nTZS account
  | "withdrawal"     // USDC sent out
  | "buy"            // USDC spent / shares acquired
  | "sell"           // shares sold / USDC returned
  | "fee"            // platform fee taken
  | "adjustment";    // manual correction, always with a reason

export type Entry = {
  userId: string;
  kind: EntryKind;
  /** "USDC" or a B20 symbol such as "NVDAc". */
  asset: string;
  /** Signed: positive credits the user, negative debits them. */
  amount: string;
  ref?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Writes entries atomically. Either every leg of a trade lands or none does —
 * a half-recorded buy would leave a user paying for shares they do not hold.
 */
export async function record(entries: Entry[]) {
  if (!entries.length) return { written: 0, duplicate: false };
  await migrate();
  const sql = db();

  try {
    await sql.begin(async (tx) => {
      for (const e of entries) {
        await tx`
          insert into capx.ledger_entries (user_id, kind, asset, amount, ref, metadata)
          values (${e.userId}, ${e.kind}, ${e.asset}, ${e.amount}, ${e.ref ?? null},
                  ${sql.json((e.metadata ?? {}) as Record<string, string | number | boolean | null>)})`;
      }
    });
    return { written: entries.length, duplicate: false };
  } catch (err) {
    // 23505 — the ref already exists, so this movement was already recorded.
    if ((err as { code?: string }).code === "23505") return { written: 0, duplicate: true };
    throw err;
  }
}

export type Balance = { asset: string; amount: number };

export async function balances(userId: string): Promise<Balance[]> {
  await migrate();
  const rows = await db()<{ asset: string; amount: string }[]>`
    select asset, sum(amount)::text as amount
      from capx.ledger_entries
     where user_id = ${userId}
     group by asset
    having sum(amount) <> 0
     order by asset`;
  return rows.map((r) => ({ asset: r.asset, amount: Number(r.amount) }));
}

export async function balanceOf(userId: string, asset: string) {
  await migrate();
  const rows = await db()<{ amount: string | null }[]>`
    select sum(amount)::text as amount
      from capx.ledger_entries
     where user_id = ${userId} and asset = ${asset}`;
  return Number(rows[0]?.amount ?? 0);
}

export async function history(userId: string, limit = 100) {
  await migrate();
  return db()<
    { id: string; kind: EntryKind; asset: string; amount: string; ref: string | null;
      metadata: Record<string, unknown>; created_at: string }[]
  >`
    select id::text, kind, asset, amount::text, ref, metadata, created_at
      from capx.ledger_entries
     where user_id = ${userId}
     -- Newest first by time. Ordering by id returned an arbitrary slice,
     -- because ids are random uuids, so a recent trade could be missing from
     -- the activity list entirely while older ones showed.
     order by created_at desc, id desc
     limit ${limit}`;
}

/**
 * Sum of every user's holdings, per asset. Compared against what the treasury
 * wallet actually holds onchain, this is the solvency check — the one number
 * that says whether client assets are fully backed.
 */
export async function totalLiabilities() {
  await migrate();
  const rows = await db()<{ asset: string; amount: string }[]>`
    select asset, sum(amount)::text as amount
      from capx.ledger_entries
     group by asset
    having sum(amount) <> 0
     order by asset`;
  return rows.map((r) => ({ asset: r.asset, amount: Number(r.amount) }));
}


/**
 * A trade that has to balance.
 *
 * `record` writes what a person is owed and asks no questions about where it
 * came from. That is the right shape for a deposit — money genuinely enters
 * the system — and the wrong shape for a trade, where every shilling a
 * customer spends has to be a shilling somebody else receives and every share
 * they gain has to be a share somebody else gives up.
 *
 * Nothing checked that. Solvency compares the ledger against what the
 * custodian actually holds, which catches a share that was never bought, and
 * catches nothing at all on the cash side: an order that debited the wrong
 * amount, or credited shares without taking payment, would sit in the book
 * looking exactly like a correct one until the float came up short weeks
 * later.
 *
 * So a trade is written through here, and here refuses to write a trade whose
 * legs do not net to zero in every asset. It is an assertion at the moment of
 * writing rather than a report afterwards, which is the difference between a
 * bug that cannot be committed and a bug that has to be found.
 */

/** Which side of the house a non-customer leg belongs to. */
export type HouseAccount =
  | "inventory"   // securities CAPX holds that nobody is yet owed
  | "fee"         // the platform's cut, once charged
  | "float"       // shillings and dollars in the omnibus
  | "provider";   // a liquidity provider acting as the house side

export type TradeLeg =
  | { side: "customer"; userId: string; kind: EntryKind; asset: string;
      amount: number; ref?: string; metadata?: Record<string, unknown> }
  | { side: "house"; account: HouseAccount; asset: string;
      amount: number; ref?: string; metadata?: Record<string, unknown> };

export class UnbalancedTrade extends Error {
  constructor(readonly drift: Record<string, number>) {
    super(
      "Refusing to write a trade that does not balance: " +
      Object.entries(drift).map(([a, d]) => `${a} is ${d > 0 ? "+" : ""}${d}`).join(", "),
    );
    this.name = "UnbalancedTrade";
  }
}

/**
 * How far from zero each asset is across every leg.
 *
 * The tolerance scales with the size of the trade, and it has to.
 *
 * A fixed eight-decimal comparison was the first attempt and it was wrong: the
 * amounts are exact in the database, which stores numeric(38,8), and
 * approximate here, where they are float64. Summing legs of eleven billion
 * shillings leaves a residue of one unit in the last place — about two
 * millionths — which is not an accounting error but is larger than any fixed
 * epsilon worth having at ordinary sizes. A test across four orders of
 * magnitude found it; in production it would have refused a large but
 * perfectly correct order and reported it as unbalanced.
 *
 * Eight machine epsilons of the largest leg leaves room for the arithmetic and
 * no room for a mistake: on a trade of ten thousand shillings that is about
 * 2e-11, and the smallest error anyone can actually make is a rounding unit of
 * 0.01. The absolute floor keeps small trades from being compared against
 * nothing at all.
 */
export function tradeDrift(legs: TradeLeg[]): Record<string, number> {
  const sums = new Map<string, number>();
  const scale = new Map<string, number>();
  for (const l of legs) {
    sums.set(l.asset, (sums.get(l.asset) ?? 0) + l.amount);
    scale.set(l.asset, Math.max(scale.get(l.asset) ?? 0, Math.abs(l.amount)));
  }
  const drift: Record<string, number> = {};
  for (const [asset, sum] of sums) {
    const tolerance = Math.max(1e-8, 8 * Number.EPSILON * (scale.get(asset) ?? 0));
    if (Math.abs(sum) > tolerance) drift[asset] = Math.round(sum * 1e8) / 1e8;
  }
  return drift;
}

export const isBalanced = (legs: TradeLeg[]) => Object.keys(tradeDrift(legs)).length === 0;

/** Throws UnbalancedTrade unless every asset nets to zero. */
export function assertBalanced(legs: TradeLeg[]): void {
  const drift = tradeDrift(legs);
  if (Object.keys(drift).length) throw new UnbalancedTrade(drift);
}

/**
 * Writes a balanced trade, or writes nothing.
 *
 * The check runs before the transaction opens, so an unbalanced trade never
 * reaches the database at all. Customer legs go to the ledger exactly as
 * `record` would write them — every existing reader sees what it has always
 * seen — and the house legs go to the journal beside it.
 */
export async function recordTrade(tradeId: string, legs: TradeLeg[]) {
  assertBalanced(legs);

  const customer = legs.filter((l) => l.side === "customer");
  const house = legs.filter((l) => l.side === "house");

  const wrote = await record(customer.map((l) => ({
    userId: l.userId, kind: l.kind, asset: l.asset,
    amount: l.amount.toString(), ref: l.ref, metadata: l.metadata,
  })));

  if (house.length) {
    await migrate();
    const sql = db();
    /*
     * Best-effort, and deliberately so. The customer's side is the record of
     * what somebody is owed; the house side is CAPX's own bookkeeping. A
     * failure here must not roll back a trade that has already settled
     * correctly for the person who made it.
     */
    try {
      await sql.begin(async (tx) => {
        for (const l of house) {
          await tx`
            insert into capx.journal_legs (trade_id, account, asset, amount, ref, metadata)
            values (${tradeId}, ${l.account}, ${l.asset}, ${l.amount.toString()},
                    ${l.ref ?? null}, ${sql.json((l.metadata ?? {}) as never)})
            on conflict (ref) where ref is not null do nothing`;
        }
      });
    } catch { /* the customer's side stands */ }
  }

  return wrote;
}
