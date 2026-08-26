import "server-only";
import { db, migrate } from "./db";

/**
 * Custodial ledger.
 *
 * CAPIMON holds USDC and shares on behalf of nTZS users, so balances are never
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
          insert into ledger_entries (user_id, kind, asset, amount, ref, metadata)
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
      from ledger_entries
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
      from ledger_entries
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
      from ledger_entries
     where user_id = ${userId}
     order by id desc
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
      from ledger_entries
     group by asset
    having sum(amount) <> 0
     order by asset`;
  return rows.map((r) => ({ asset: r.asset, amount: Number(r.amount) }));
}
