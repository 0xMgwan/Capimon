import "server-only";
import { parseUnits, formatUnits } from "viem";
import { publicClient } from "./chain";
import { treasuryWrite, treasuryAddress } from "./treasury";
import { SECURITIES_CONTRACTS, NTZS_DECIMALS } from "./assets";
import { dseQuote, quoteAgeDays, currentPrice, type DseQuote } from "./dse";

/**
 * Publishing the DSE close to the oracle.
 *
 * The treasury key does this, not the issuing key. It holds the publisher role,
 * which can set prices and nothing else — this runs often and from a server, so
 * it must not be able to mint.
 *
 * Prices are stored in the settlement currency's smallest unit per whole share.
 * nTZS carries eighteen decimals, so 2,980 shillings is 2980e18. Getting that
 * wrong by a factor of a decimal place would not fail loudly; it would settle.
 */

const oracleAbi = [
  { type: "function", name: "setPrice", stateMutability: "nonpayable",
    inputs: [{ name: "symbol", type: "string" }, { name: "price", type: "uint256" },
             { name: "source", type: "string" }], outputs: [] },
  { type: "function", name: "peek", stateMutability: "view",
    inputs: [{ name: "symbol", type: "string" }],
    outputs: [
      { type: "tuple", components: [
        { name: "price", type: "uint256" }, { name: "updatedAt", type: "uint64" },
        { name: "source", type: "string" }, { name: "active", type: "bool" }] },
      { type: "bool" }] },
  { type: "function", name: "publisher", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxAge", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
] as const;

const ORACLE = SECURITIES_CONTRACTS.priceOracle as `0x${string}`;

/**
 * A move large enough that it is more likely a bad print than a real one.
 *
 * DSE has a daily price band well inside this. The check is not trying to
 * second-guess the market — it is there because a feed returning a wrong number
 * would otherwise be published, and settlement prices off whatever is published.
 */
const IMPLAUSIBLE_MOVE_PCT = 25;

export type OraclePrice = {
  symbol: string;
  price: number;
  updatedAt: string;
  source: string;
  fresh: boolean;
};

export async function readOraclePrice(symbol: string): Promise<OraclePrice | null> {
  const [quote, fresh] = (await publicClient.readContract({
    address: ORACLE, abi: oracleAbi, functionName: "peek", args: [symbol],
  })) as [{ price: bigint; updatedAt: bigint; source: string; active: boolean }, boolean];
  if (!quote.active) return null;
  return {
    symbol,
    price: Number(formatUnits(quote.price, NTZS_DECIMALS)),
    updatedAt: new Date(Number(quote.updatedAt) * 1000).toISOString(),
    source: quote.source,
    fresh,
  };
}

export type PublishResult =
  | { ok: true; txHash: string; price: number; quote: DseQuote; unchanged?: false }
  | { ok: true; txHash: null; price: number; quote: DseQuote; unchanged: true }
  | { ok: false; reason: string; quote?: DseQuote | null };

/**
 * Pushes a security's latest DSE close on-chain.
 *
 * Refuses rather than publishes when something looks wrong. A price that is not
 * published leaves the previous one standing until it ages out, and settlement
 * then stops on its own — which is the safe failure. A bad price that *is*
 * published settles trades at it.
 */
export async function publishDsePrice(
  symbol: string,
  opts: { force?: boolean } = {},
): Promise<PublishResult> {
  if (!treasuryAddress()) return { ok: false, reason: "No treasury key is configured to publish with." };

  const quote = await dseQuote(symbol, { force: true });
  if (!quote) return { ok: false, reason: `DSE returned no price for ${symbol}.`, quote: null };
  /*
   * The live price while a session is running, the close otherwise.
   *
   * Both are the exchange's own figures. Settling a lunchtime trade against
   * yesterday's close means every trade of the day prices off a number the
   * market has already moved away from, and the deviation guard on the
   * settlement engine is what would eventually refuse them.
   */
  const price = currentPrice(quote);
  if (!(price > 0)) return { ok: false, reason: `DSE returned a zero price for ${symbol}.`, quote };

  // Publishing a quote already older than the contract tolerates would write a
  // mark that is stale the moment it lands.
  const maxAge = Number(await publicClient.readContract({
    address: ORACLE, abi: oracleAbi, functionName: "maxAge",
  }) as bigint);
  const age = quoteAgeDays(quote);
  if (age * 86_400 > maxAge && !opts.force) {
    return {
      ok: false,
      reason: `The last DSE print for ${symbol} is ${age} days old, beyond the ${Math.round(maxAge / 86_400)}-day window. The exchange has not traded it recently.`,
      quote,
    };
  }

  const current = await readOraclePrice(symbol).catch(() => null);
  if (current && current.price > 0 && !opts.force) {
    const movePct = Math.abs((price - current.price) / current.price) * 100;
    if (movePct > IMPLAUSIBLE_MOVE_PCT) {
      return {
        ok: false,
        reason: `${symbol} would move ${movePct.toFixed(1)}%, from ${current.price} to ${price}. That is larger than DSE's daily band, so it is being treated as a bad print rather than published.`,
        quote,
      };
    }
    // Republishing the same number still refreshes the timestamp, which is the
    // point on a day the exchange did not move — but only once it needs to be.
    if (current.price === price && current.fresh) {
      return { ok: true, txHash: null, price, quote, unchanged: true };
    }
  }

  const txHash = await treasuryWrite({
    address: ORACLE,
    abi: oracleAbi,
    functionName: "setPrice",
    args: [
      symbol,
      parseUnits(String(price), NTZS_DECIMALS),
      // The source says which figure this is, so a mark can be traced to the
      // session that made it rather than merely to the exchange.
      quote.live !== null ? `DSE live ${new Date().toISOString().slice(0, 10)}` : `DSE close ${quote.tradeDate}`,
    ],
  });

  return { ok: true, txHash, price, quote };
}


/* --------------------------------------------------------- opportunistic -- */

/**
 * Refreshes a stale mark without waiting for the scheduler.
 *
 * The hourly cron is the intended mechanism, but a schedule is a promise made
 * by the host and hosting plans cap how often one may fire. A mark that only
 * moves when a cron happens to run means customers trade all afternoon against
 * the morning's price, and the first anyone knows is a settlement refused for
 * deviating from a number nobody refreshed.
 *
 * The staleness test is a chain read, so every instance sees the same answer
 * and they do not each decide independently to publish. Nothing here is
 * awaited by the caller: a page load should never wait on a transaction, and a
 * failed refresh leaves the previous mark standing, which is the safe outcome.
 */
const REFRESH_AFTER_MS = 12 * 60_000;

export function refreshIfStale(symbol: string) {
  void (async () => {
    try {
      const current = await readOraclePrice(symbol);
      if (current) {
        const age = Date.now() - Date.parse(current.updatedAt);
        if (age < REFRESH_AFTER_MS) return;

        // Old, but only worth a transaction if the exchange has actually moved.
        const quote = await dseQuote(symbol);
        if (quote && currentPrice(quote) === current.price) return;
      }
      await publishDsePrice(symbol);
    } catch {
      /* the previous mark stands, which is the safe failure */
    }
  })();
}
