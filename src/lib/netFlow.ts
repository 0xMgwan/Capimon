import "server-only";
import { db, dbConfigured, migrate } from "./db";

/**
 * What actually moves the shilling float, day by day.
 *
 * The redemption panel answers a stress question — everybody sells at once —
 * which is the right shape for understanding the exposure and the wrong
 * number for sizing anything. A facility is sized by the worst day that
 * plausibly happens, not by the worst day imaginable.
 *
 * Two flows, and keeping them apart is the point.
 *
 * **Cash** is deposits in against withdrawals out. This is the only thing
 * that changes how many shillings CAPX is holding. A share trade does not:
 * when somebody buys CRDB the money stays exactly where it was and the
 * ledger simply reassigns it, because CAPX is not buying anything — the
 * shares were already bought and custodied by the broker.
 *
 * **Claims** are what share trades create and consume. A sale turns a share
 * position into a shilling balance somebody can ask for; a purchase turns a
 * shilling balance back into a share position. Claims are not cash, but every
 * claim is a future withdrawal, so a day that creates far more claims than it
 * consumes is a day that has borrowed from a future float.
 *
 * The number that sizes an LP line is the worst net cash day, widened by the
 * claims built up above it.
 */

export type FlowDay = {
  /** ISO date, one row per day including days nothing happened. */
  day: string;
  /** Shillings that arrived from mobile money or a bank. */
  depositsTzs: number;
  /** Shillings that left for a customer's phone or bank. */
  withdrawalsTzs: number;
  /** deposits − withdrawals: what the float actually gained or lost. */
  netCashTzs: number;
  /** Shilling balances created by customers selling shares. */
  claimsCreatedTzs: number;
  /** Shilling balances spent by customers buying shares. */
  claimsSpentTzs: number;
};

export type NetFlow = {
  days: FlowDay[];
  /** The worst single day of net cash outflow, as a positive number. */
  worstOutflowTzs: number;
  worstOutflowDay: string | null;
  /** Mean daily net cash over the window; negative means the float is draining. */
  meanNetCashTzs: number;
  /** The deepest the float went below its starting point across the window. */
  deepestDrawdownTzs: number;
  /** What is in the float now, for scale. */
  floatTzs: number;
  /**
   * Days of cover at the observed drain rate. Null when the float is not
   * draining, because a runway is only meaningful when something is running
   * out.
   */
  runwayDays: number | null;
};

export async function netFlow(days = 30): Promise<NetFlow | null> {
  if (!dbConfigured) return null;
  await migrate();
  const sql = db();

  /*
   * Every day in the window, including the empty ones.
   *
   * A chart that omits quiet days compresses time and makes a single busy
   * afternoon look like a trend. generate_series keeps the axis honest.
   */
  const rows = await sql<{ day: string; deposits: string; withdrawals: string;
                           claims_created: string; claims_spent: string }[]>`
    with span as (
      select generate_series(
        (now() at time zone 'utc')::date - ${days - 1}::int,
        (now() at time zone 'utc')::date,
        interval '1 day'
      )::date as day
    ),
    dep as (
      select settled_at::date as day, coalesce(sum(amount_tzs), 0) as total
        from capx.deposits
       where status = 'settled' and settled_at is not null
       group by 1
    ),
    wdr as (
      /* Withdrawals are ledger entries: there is no table of their own, and
         the entry is written once the money has actually left. */
      select created_at::date as day, coalesce(sum(abs(amount)), 0) as total
        from capx.ledger_entries
       where kind = 'withdrawal' and asset = 'TZS'
       group by 1
    ),
    claims as (
      /* The shilling leg of a share trade, joined by the reference the order
         wrote. A sell credits shillings; a buy spends them. */
      select l.created_at::date as day,
             coalesce(sum(case when o.side = 'sell' then abs(l.amount) else 0 end), 0) as created,
             coalesce(sum(case when o.side = 'buy'  then abs(l.amount) else 0 end), 0) as spent
        from capx.orders o
        join capx.ledger_entries l on l.ref = o.id::text || ':cash' and l.asset = 'TZS'
       where o.status = 'settled'
       group by 1
    )
    select span.day::text,
           coalesce(dep.total, 0)::text     as deposits,
           coalesce(wdr.total, 0)::text     as withdrawals,
           coalesce(claims.created, 0)::text as claims_created,
           coalesce(claims.spent, 0)::text   as claims_spent
      from span
      left join dep    on dep.day = span.day
      left join wdr    on wdr.day = span.day
      left join claims on claims.day = span.day
     order by span.day`;

  const flow: FlowDay[] = rows.map((r) => {
    const depositsTzs = Number(r.deposits);
    const withdrawalsTzs = Number(r.withdrawals);
    return {
      day: r.day,
      depositsTzs,
      withdrawalsTzs,
      netCashTzs: depositsTzs - withdrawalsTzs,
      claimsCreatedTzs: Number(r.claims_created),
      claimsSpentTzs: Number(r.claims_spent),
    };
  });

  let worstOutflowTzs = 0;
  let worstOutflowDay: string | null = null;
  for (const d of flow) {
    if (-d.netCashTzs > worstOutflowTzs) {
      worstOutflowTzs = -d.netCashTzs;
      worstOutflowDay = d.day;
    }
  }

  /*
   * The deepest the float fell below where it started.
   *
   * A run of small outflows drains as surely as one large one, and the worst
   * single day misses it entirely — so the cumulative low is tracked too. It
   * is the figure a facility actually has to cover.
   */
  let running = 0;
  let deepestDrawdownTzs = 0;
  for (const d of flow) {
    running += d.netCashTzs;
    if (running < -deepestDrawdownTzs) deepestDrawdownTzs = -running;
  }

  const meanNetCashTzs = flow.length
    ? flow.reduce((s, d) => s + d.netCashTzs, 0) / flow.length
    : 0;

  const { omnibusBalances } = await import("./omnibus");
  const floatTzs = await omnibusBalances().then((b) => b.tzs).catch(() => 0);

  return {
    days: flow,
    worstOutflowTzs,
    worstOutflowDay,
    meanNetCashTzs,
    deepestDrawdownTzs,
    floatTzs,
    runwayDays: meanNetCashTzs < 0 ? floatTzs / -meanNetCashTzs : null,
  };
}
