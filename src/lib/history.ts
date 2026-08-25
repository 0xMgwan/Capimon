import "server-only";
import { formatUnits, parseAbiItem, type Log } from "viem";
import { ASSETS, USDC_BASE } from "./assets";
import { publicClient } from "./chain";
import { getMarkets, type Candle } from "./markets";

/**
 * Wallet activity and cost basis, rebuilt from Transfer logs.
 *
 * B20 equities only went live on Base days ago, so a complete history fits in a
 * few hundred thousand blocks. The public RPC caps eth_getLogs at a 10k range,
 * so a wide query is tried first (it succeeds on a dedicated provider) and the
 * chunked path is the fallback.
 */

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const LOOKBACK_BLOCKS = 360_000n; // ~8.3 days at 2s blocks — covers all B20 history so far
const CHUNK = 9_500n;
const CONCURRENCY = 12;
/** Hard ceiling on log scanning so the endpoint always answers, partial if need be. */
const BUDGET_MS = 20_000;

export type Activity = {
  kind: "buy" | "sell" | "receive" | "send";
  symbol: string;
  ticker: string;
  qty: number;
  /** USDC actually moved in the same transaction, when this was a swap. */
  usdc: number | null;
  /** Unit price used for accounting — the real fill when known, else the mark. */
  price: number;
  value: number;
  priceSource: "fill" | "oracle";
  ts: number;
  tx: `0x${string}`;
};

export type Position = {
  symbol: string; ticker: string; name: string; color: string; logo: string | null;
  qty: number;
  avgCost: number | null;
  costBasis: number;
  marketValue: number;
  unrealised: number;
  unrealisedPct: number | null;
  realised: number;
  price: number;
};

export type WalletHistory = {
  address: string;
  fromBlock: string;
  /** False when any log range failed to read — the history is then understated. */
  complete: boolean;
  missedRanges: number;
  totalRanges: number;
  positions: Position[];
  activity: Activity[];
  totals: { marketValue: number; costBasis: number; unrealised: number; realised: number };
};

type TransferLog = Log<bigint, number, false, undefined, true, [typeof TRANSFER], "Transfer">;

async function logsInRange(addresses: `0x${string}`[], from: bigint, to: bigint, key: "from" | "to", who: `0x${string}`) {
  return publicClient.getLogs({
    address: addresses,
    event: TRANSFER,
    args: key === "from" ? { from: who } : { to: who },
    fromBlock: from,
    toBlock: to,
  }) as Promise<TransferLog[]>;
}

/**
 * Wide query first; fall back to bounded chunks when the node refuses the range.
 *
 * Failures are counted rather than swallowed. A rate-limited chunk silently
 * returning nothing would understate a wallet's history, and wrong cost basis
 * shown confidently is worse than none at all.
 */
async function collect(addresses: `0x${string}`[], from: bigint, to: bigint, who: `0x${string}`) {
  const directions: ("from" | "to")[] = ["from", "to"];

  try {
    const wide = await Promise.all(directions.map((d) => logsInRange(addresses, from, to, d, who)));
    return { logs: wide.flat(), missed: 0, total: 2 };
  } catch {
    /* node enforces a range cap — chunk it */
  }

  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += CHUNK + 1n) {
    ranges.push([start, start + CHUNK > to ? to : start + CHUNK]);
  }

  type Job = { range: [bigint, bigint]; dir: "from" | "to" };
  const jobs: Job[] = ranges.flatMap((range) => directions.map((dir) => ({ range, dir })));

  const logs: TransferLog[] = [];
  const deadline = Date.now() + BUDGET_MS;
  const run = async (queue: Job[]) => {
    const failed: Job[] = [];
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      if (Date.now() > deadline) {
        // Out of budget: everything still queued counts as unread, not as absent.
        failed.push(...queue.slice(i));
        break;
      }
      const batch = queue.slice(i, i + CONCURRENCY);
      const res = await Promise.all(
        batch.map((j) =>
          logsInRange(addresses, j.range[0], j.range[1], j.dir, who).then(
            (r) => ({ ok: true as const, r }),
            () => ({ ok: false as const, j }),
          ),
        ),
      );
      for (const x of res) {
        if (x.ok) logs.push(...x.r);
        else failed.push(x.j);
      }
    }
    return failed;
  };

  let failed = await run(jobs);
  // Retry only a handful of stragglers. Widespread failure means the RPC is
  // rate limiting, and hammering it again just burns the budget.
  if (failed.length && failed.length <= jobs.length / 4 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    failed = await run(failed);
  }

  return { logs, missed: failed.length, total: jobs.length };
}

/** Mark nearest a timestamp, for transfers that were not swaps. */
function markAt(history: Candle[], ts: number, fallback: number) {
  if (!history.length) return fallback;
  let best = history[0];
  for (const c of history) if (Math.abs(c.t - ts) < Math.abs(best.t - ts)) best = c;
  return best.p;
}

export async function getWalletHistory(address: `0x${string}`): Promise<WalletHistory> {
  const [headBlock, markets] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    getMarkets(),
  ]);
  const head = headBlock.number!;
  const fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;

  const tokens = ASSETS.map((a) => a.token);
  const { logs, missed, total } = await collect([...tokens, USDC_BASE], fromBlock, head, address);

  // Base produces blocks on a fixed 2s cadence, so timestamps are interpolated
  // from the head rather than fetched per block. Timestamps are only used to
  // pick the nearest oracle round, which are minutes apart — a couple of
  // seconds of drift is irrelevant, and this removes a request per block.
  const headTs = Number(headBlock.timestamp);
  const tsOf = (block: bigint) => headTs - Number(head - block) * 2;

  // USDC legs, keyed by transaction, so a swap can be priced at its real fill.
  const usdcByTx = new Map<string, number>();
  const b20LegsByTx = new Map<string, number>();
  for (const l of logs) {
    if (l.address.toLowerCase() === USDC_BASE.toLowerCase()) {
      const signed = l.args.to?.toLowerCase() === address.toLowerCase() ? 1 : -1;
      usdcByTx.set(
        l.transactionHash,
        (usdcByTx.get(l.transactionHash) ?? 0) + Number(formatUnits(l.args.value ?? 0n, 6)) * signed,
      );
    } else if (ASSETS.some((a) => a.token.toLowerCase() === l.address.toLowerCase())) {
      b20LegsByTx.set(l.transactionHash, (b20LegsByTx.get(l.transactionHash) ?? 0) + 1);
    }
  }

  /** How far an implied fill may sit from the mark before we distrust it. */
  const FILL_TOLERANCE = 0.25;

  const activity: Activity[] = [];
  for (const l of logs) {
    const asset = ASSETS.find((a) => a.token.toLowerCase() === l.address.toLowerCase());
    if (!asset) continue;
    const market = markets.find((m) => m.symbol === asset.symbol)!;
    const incoming = l.args.to?.toLowerCase() === address.toLowerCase();
    const qty = Number(formatUnits(l.args.value ?? 0n, market.decimals)) * market.multiplier;
    if (qty <= 0) continue;

    const ts = tsOf(l.blockNumber);
    const mark = markAt(market.history, ts, market.price);
    const netUsdc = usdcByTx.get(l.transactionHash) ?? 0;

    // Treat the USDC leg as the real fill only when it can be attributed
    // unambiguously to this transfer:
    //  - the transaction moved exactly one B20 asset, so the USDC is not
    //    shared across several equity legs;
    //  - the USDC moved the opposite way to the shares;
    //  - the implied unit price agrees with the oracle. Round-trip and
    //    arbitrage transactions net their USDC to near zero, which would
    //    otherwise book shares at a price of nothing and poison the basis.
    const soleLeg = (b20LegsByTx.get(l.transactionHash) ?? 0) === 1;
    const opposed = incoming ? netUsdc < 0 : netUsdc > 0;
    const absUsdc = Math.abs(netUsdc);
    const implied = absUsdc / qty;
    const agrees = mark > 0 && implied >= mark * (1 - FILL_TOLERANCE) && implied <= mark * (1 + FILL_TOLERANCE);
    const isFill = soleLeg && opposed && absUsdc > 0 && agrees;

    const value = isFill ? absUsdc : qty * mark;

    activity.push({
      kind: incoming ? (isFill ? "buy" : "receive") : isFill ? "sell" : "send",
      symbol: asset.symbol, ticker: asset.ticker, qty, usdc: isFill ? absUsdc : null,
      price: value / qty, value,
      priceSource: isFill ? "fill" : "oracle",
      ts, tx: l.transactionHash,
    });
  }

  activity.sort((a, b) => a.ts - b.ts || a.tx.localeCompare(b.tx));

  // Average-cost accounting: every disposal realises against the running average.
  const positions: Position[] = [];
  for (const asset of ASSETS) {
    const market = markets.find((m) => m.symbol === asset.symbol)!;
    const events = activity.filter((e) => e.symbol === asset.symbol);
    if (!events.length) continue;

    let qty = 0, cost = 0, realised = 0;
    for (const e of events) {
      if (e.kind === "buy" || e.kind === "receive") {
        qty += e.qty;
        cost += e.value;
      } else {
        const avg = qty > 0 ? cost / qty : 0;
        const sold = Math.min(e.qty, qty);
        realised += e.value - avg * sold;
        cost -= avg * sold;
        qty -= sold;
      }
    }
    qty = Math.max(0, qty);
    const marketValue = qty * market.price;
    const costBasis = Math.max(0, cost);

    positions.push({
      symbol: asset.symbol, ticker: asset.ticker, name: asset.name, color: asset.color, logo: market.logo,
      qty, avgCost: qty > 0 ? costBasis / qty : null, costBasis, marketValue,
      unrealised: marketValue - costBasis,
      unrealisedPct: costBasis > 0 ? ((marketValue - costBasis) / costBasis) * 100 : null,
      realised, price: market.price,
    });
  }

  positions.sort((a, b) => b.marketValue - a.marketValue);
  activity.reverse(); // newest first for display

  return {
    address,
    fromBlock: fromBlock.toString(),
    // Complete only if every range was actually read. The lookback itself covers
    // all B20 history to date, so an incomplete result means the RPC dropped
    // requests — the UI must say so rather than imply the wallet was quiet.
    complete: missed === 0,
    missedRanges: missed,
    totalRanges: total,
    positions,
    activity,
    totals: {
      marketValue: positions.reduce((s, p) => s + p.marketValue, 0),
      costBasis: positions.reduce((s, p) => s + p.costBasis, 0),
      unrealised: positions.reduce((s, p) => s + p.unrealised, 0),
      realised: positions.reduce((s, p) => s + p.realised, 0),
    },
  };
}
