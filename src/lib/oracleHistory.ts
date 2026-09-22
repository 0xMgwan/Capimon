import "server-only";
import { formatUnits, parseAbiItem } from "viem";
import { publicClient } from "./chain";
import { db, migrate } from "./db";
import { SECURITIES_CONTRACTS, NTZS_DECIMALS } from "./assets";

/**
 * A price history built from the oracle's own events.
 *
 * Every price CAPX publishes is a PriceSet event on Base, so a history can be
 * drawn from them even when the exchange is unreachable. Public RPCs cap log
 * queries at 2,000 blocks, so the backlog is read in small batches — a few
 * per call, the position kept in `sync_cursors` — and finishes over a handful
 * of requests without any one of them running long.
 */
const ORACLE = SECURITIES_CONTRACTS.priceOracle as `0x${string}`;
/** The block the current oracle was deployed in; nothing before it. */
const DEPLOY_BLOCK = 51_326_431n;
const SPAN = 2_000n;
const CURSOR = "oracle_points";
const event = parseAbiItem("event PriceSet(string symbol, uint256 price, string source, uint64 updatedAt)");

/** Reads up to `batches` × 2,000 blocks of new oracle events into the table. */
export async function syncOraclePoints(batches = 25): Promise<{ from: bigint; to: bigint; added: number }> {
  await migrate();
  const sql = db();
  const [row] = await sql<{ block: string }[]>`select block::text from capx.sync_cursors where name = ${CURSOR}`;
  const start = row ? BigInt(row.block) + 1n : DEPLOY_BLOCK;
  const head = await publicClient.getBlockNumber();
  let from = start;
  let added = 0;
  for (let i = 0; i < batches && from <= head; i++) {
    const to = from + SPAN - 1n > head ? head : from + SPAN - 1n;
    const logs = await publicClient.getLogs({ address: ORACLE, event, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const a = l.args;
      if (!a.symbol || a.price === undefined || a.updatedAt === undefined) continue;
      await sql`
        insert into capx.oracle_points (symbol, price, at, block, source)
        values (${a.symbol.toUpperCase()}, ${formatUnits(a.price, NTZS_DECIMALS)},
                ${new Date(Number(a.updatedAt) * 1000)}, ${Number(l.blockNumber)}, ${a.source ?? null})
        on conflict (symbol, at) do nothing`;
      added++;
    }
    await sql`
      insert into capx.sync_cursors (name, block) values (${CURSOR}, ${Number(to)})
      on conflict (name) do update set block = excluded.block, updated_at = now()`;
    from = to + 1n;
  }
  return { from: start, to: from - 1n, added };
}

/** One point per day — the day's last published price — in the chart's shape. */
export async function oracleHistory(symbol: string): Promise<{ t: number; p: number; round: string }[]> {
  await migrate();
  const rows = await db()<{ day: string; price: string; at: string }[]>`
    select distinct on (date_trunc('day', at)) date_trunc('day', at)::date::text as day, price::text, at
      from capx.oracle_points where symbol = ${symbol.toUpperCase()}
     order by date_trunc('day', at), at desc`;
  return rows.map((r) => ({ t: Math.floor(Date.parse(r.at) / 1000), p: Number(r.price), round: r.day }));
}
