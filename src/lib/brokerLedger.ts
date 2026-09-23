import "server-only";
import { db, dbConfigured, migrate } from "./db";
import { BROKER_FEE_BPS, FEE_BPS, brokerShare } from "./fees";

/**
 * What CAPX owes the broker, and what it has paid them.
 *
 * The fee on a shilling trade is 250 basis points, of which 100 are the
 * broker's: they hold the shares, file the attestation that lets them be
 * tokenised, and carry the regulated relationship with the exchange. Their
 * share is money owed rather than a figure for a dashboard, so it is kept the
 * way the customers' money is kept — an append-only ledger whose balance is
 * the sum of its rows, never a stored total that can drift from them.
 *
 * The shillings sit in the omnibus until a payout is made. This is the record
 * of the claim, not a second pot of money.
 */
export type BrokerEntry = {
  id: string;
  kind: string;
  amountTzs: number;
  security: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

export const BROKER_PARTY = "fimco";

/**
 * Credits the broker their share of a fee just charged.
 *
 * Keyed to the order, so a retry or a replayed settlement cannot pay twice —
 * the same guarantee the customer ledger gets from its own ref. Never throws:
 * a fee that could not be recorded must not unwind a trade that has already
 * settled, and the row can be reconciled from the orders table afterwards.
 */
export async function accrueBrokerFee(input: {
  orderId: string; security: string; fee: number;
}): Promise<number> {
  const amount = brokerShare(input.fee);
  if (!(amount > 0) || !dbConfigured) return 0;
  try {
    await migrate();
    await db()`
      insert into capx.broker_ledger (party, kind, amount_tzs, security, order_id, ref, created_by)
      values (${BROKER_PARTY}, 'fee', ${amount}, ${input.security}, ${input.orderId}::uuid,
              ${`order:${input.orderId}:broker`}, 'system')
      on conflict (ref) where ref is not null do nothing`;
    return amount;
  } catch {
    return 0;
  }
}

export async function brokerBalance(party = BROKER_PARTY): Promise<number> {
  if (!dbConfigured) return 0;
  await migrate();
  const [row] = await db()<{ total: string | null }[]>`
    select coalesce(sum(amount_tzs), 0)::text as total
      from capx.broker_ledger where party = ${party}`;
  return Number(row?.total ?? 0);
}

export async function brokerEntries(party = BROKER_PARTY, limit = 50): Promise<BrokerEntry[]> {
  if (!dbConfigured) return [];
  await migrate();
  const rows = await db()<{ id: string; kind: string; amount_tzs: string; security: string | null;
                            note: string | null; created_by: string | null; created_at: string }[]>`
    select id::text, kind, amount_tzs::text, security, note, created_by, created_at
      from capx.broker_ledger where party = ${party}
     order by created_at desc, id desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, kind: r.kind, amountTzs: Number(r.amount_tzs), security: r.security,
    note: r.note, createdBy: r.created_by, createdAt: r.created_at,
  }));
}

/** Earnings per day, for the chart on the broker's desk. */
export async function brokerDaily(party = BROKER_PARTY, days = 30): Promise<{ day: string; earned: number; trades: number }[]> {
  if (!dbConfigured) return [];
  await migrate();
  const rows = await db()<{ day: string; earned: string; trades: number }[]>`
    select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
           coalesce(sum(amount_tzs), 0)::text as earned,
           count(*)::int as trades
      from capx.broker_ledger
     where party = ${party} and kind = 'fee'
       and created_at > now() - ${`${days} days`}::interval
     group by 1 order by 1`;
  return rows.map((r) => ({ day: r.day, earned: Number(r.earned), trades: r.trades }));
}

/** Which securities earned it, so the broker can see where the volume is. */
export async function brokerBySecurity(party = BROKER_PARTY): Promise<{ security: string; earned: number; trades: number }[]> {
  if (!dbConfigured) return [];
  await migrate();
  const rows = await db()<{ security: string | null; earned: string; trades: number }[]>`
    select security, coalesce(sum(amount_tzs), 0)::text as earned, count(*)::int as trades
      from capx.broker_ledger
     where party = ${party} and kind = 'fee'
     group by security order by sum(amount_tzs) desc`;
  return rows.map((r) => ({ security: r.security ?? "—", earned: Number(r.earned), trades: r.trades }));
}

/**
 * Records a payment made to the broker.
 *
 * CAPX's to record, never the broker's: a party that can credit its own
 * account is not keeping a ledger. The amount is negative on the row because
 * the balance is the sum of the rows and a payout reduces what is owed.
 *
 * `ref` makes it idempotent where a real disbursement is involved: the money
 * leaves once, and a retry of the request that sent it must not write a
 * second row claiming it left twice.
 */
export async function recordPayout(input: {
  amountTzs: number; note: string | null; by: string; party?: string; ref?: string | null;
}): Promise<{ id: string; balance: number }> {
  const party = input.party ?? BROKER_PARTY;
  if (!(input.amountTzs > 0)) throw new Error("A payout must be greater than zero.");
  const owed = await brokerBalance(party);
  if (input.amountTzs > owed) {
    throw new Error(`Only ${Math.round(owed).toLocaleString()} TZS is owed.`);
  }
  await migrate();
  const [row] = await db()<{ id: string }[]>`
    insert into capx.broker_ledger (party, kind, amount_tzs, note, created_by, ref)
    values (${party}, 'payout', ${-input.amountTzs}, ${input.note}, ${input.by}, ${input.ref ?? null})
    returning id::text`;
  return { id: row.id, balance: await brokerBalance(party) };
}

/** The split, for showing on both desks. */
export const FEE_SPLIT = {
  totalBps: FEE_BPS,
  brokerBps: BROKER_FEE_BPS,
  capxBps: FEE_BPS - BROKER_FEE_BPS,
};
