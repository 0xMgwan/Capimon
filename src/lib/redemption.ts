import "server-only";
import { db, dbConfigured, migrate } from "./db";

/**
 * What CAPX would owe in shillings if everybody sold today.
 *
 * Solvency already answers the question it was built for — are the shares
 * customers hold actually held — and answers it in shares, which is the only
 * honest unit for that question. A share position cannot go unbacked because
 * a price moved.
 *
 * This is the other question, and nothing was asking it. A customer's gain is
 * money nobody paid in: they deposited what they spent, and the rest appeared
 * because the price rose. When they sell, the ledger credits shillings at
 * today's mark, and those shillings have to come from somewhere. The value
 * exists — FIMCO's shares rose by the same amount — but it exists as shares on
 * the Dar es Salaam Stock Exchange, and turning them into shillings takes days
 * and a willing buyer.
 *
 * So this is not a solvency figure. It is a liquidity one: how much cash a
 * redemption would ask for, how much is on hand, and how much of the
 * difference is gain that only exists on paper until somebody sells the
 * underlying.
 */

export type SecurityExposure = {
  symbol: string;
  /** Shares owed to customers. */
  clientHeld: number;
  /** Today's published mark, in shillings. */
  markTzs: number;
  /** What those shares would be redeemed for now. */
  valueTzs: number;
  /** What customers actually paid in, net of what they have sold back. */
  paidTzs: number;
  /** value − paid: the part nobody put in. */
  unrealisedTzs: number;
};

export type RedemptionExposure = {
  securities: SecurityExposure[];
  /** Everything owed if every holder sold at today's marks. */
  totalValueTzs: number;
  totalPaidTzs: number;
  unrealisedTzs: number;
  /** Shillings CAPX can actually pay with right now. */
  cashTzs: number;
  /** Shillings already owed as cash, before anybody sells. */
  owedCashTzs: number;
  /**
   * Cash against everything it might be asked for: the standing shilling
   * liability plus what a full redemption would add.
   */
  coverPct: number | null;
  shortfallTzs: number;
};

export async function redemptionExposure(): Promise<RedemptionExposure | null> {
  if (!dbConfigured) return null;
  await migrate();
  const sql = db();

  const { dseSecurities } = await import("./dseSecurities");
  const list = await dseSecurities().catch(() => []);
  if (!list.length) return null;

  const symbols = list.map((d) => d.symbol);

  /*
   * What customers hold, and what they paid for it.
   *
   * The cash leg of a DSE order lives in the ledger rather than on the order
   * row — the order only ever knew the dollar side — so the two are joined by
   * the reference the order wrote. Buys are money in, sells money back out,
   * so netting them gives what is actually at stake rather than gross
   * turnover.
   */
  const [held, paid] = await Promise.all([
    sql<{ asset: string; qty: string }[]>`
      select asset, sum(amount)::text as qty
        from capx.ledger_entries
       where asset = any(${symbols})
       group by asset having sum(amount) > 0`,
    sql<{ symbol: string; net_tzs: string }[]>`
      select o.symbol,
             sum(case when o.side = 'buy' then abs(l.amount) else -abs(l.amount) end)::text as net_tzs
        from capx.orders o
        join capx.ledger_entries l on l.ref = o.id::text || ':cash' and l.asset = 'TZS'
       where o.status = 'settled' and o.symbol = any(${symbols})
       group by o.symbol`,
  ]);

  const heldBy = new Map(held.map((r) => [r.asset, Number(r.qty)]));
  const paidBy = new Map(paid.map((r) => [r.symbol, Number(r.net_tzs)]));

  const { readOraclePrice } = await import("./oracle");
  const securities: SecurityExposure[] = [];

  for (const sec of list) {
    const clientHeld = heldBy.get(sec.symbol) ?? 0;
    if (!(clientHeld > 0)) continue;
    /*
     * A mark we cannot read is reported as zero rather than guessed. A
     * redemption figure built on an invented price is worse than an
     * incomplete one, because it looks complete.
     */
    const markTzs = await readOraclePrice(sec.symbol).then((p) => p?.price ?? 0).catch(() => 0);
    const valueTzs = clientHeld * markTzs;
    const paidTzs = paidBy.get(sec.symbol) ?? 0;
    securities.push({
      symbol: sec.symbol, clientHeld, markTzs, valueTzs, paidTzs,
      unrealisedTzs: valueTzs - paidTzs,
    });
  }

  const totalValueTzs = securities.reduce((s, x) => s + x.valueTzs, 0);
  const totalPaidTzs = securities.reduce((s, x) => s + x.paidTzs, 0);

  /* Shillings on hand, and shillings already owed as cash before any sale. */
  const { omnibusBalances } = await import("./omnibus");
  const { totalLiabilities } = await import("./ledger");
  const [omnibus, liabilities] = await Promise.all([
    omnibusBalances().catch(() => ({ tzs: 0, usdc: 0 })),
    totalLiabilities().catch(() => [] as { asset: string; amount: number }[]),
  ]);
  const cashTzs = omnibus.tzs;
  const owedCashTzs = liabilities.find((l) => l.asset === "TZS")?.amount ?? 0;

  const wouldOwe = owedCashTzs + totalValueTzs;
  return {
    securities: securities.sort((a, b) => b.valueTzs - a.valueTzs),
    totalValueTzs,
    totalPaidTzs,
    unrealisedTzs: totalValueTzs - totalPaidTzs,
    cashTzs,
    owedCashTzs,
    coverPct: wouldOwe > 0 ? (cashTzs / wouldOwe) * 100 : null,
    shortfallTzs: Math.max(0, wouldOwe - cashTzs),
  };
}
