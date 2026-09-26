import { NextResponse } from "next/server";
import { formatUnits, isAddress } from "viem";
import { ASSETS, USDC_BASE } from "@/lib/assets";
import { b20Abi } from "@/lib/abis";
import { publicClient } from "@/lib/chain";
import { getMarkets } from "@/lib/markets";

export const dynamic = "force-dynamic";

/**
 * Real balances for a wallet on Base, valued at the live mark.
 *
 * Two families, read the same way and priced differently. The US equities are
 * B20 tokens against a Chainlink feed; the DSE listings are CAPX's own tokens
 * against the oracle mark, converted at the nTZS rate — the same two numbers
 * the shilling ticket quotes, so a share is worth the same here as where it
 * was bought.
 *
 * The local half was missing entirely, which is why somebody who bought CRDB
 * into their own wallet, and could see it on a block explorer, was told this
 * wallet held none of the equities CAPX tracks. It held one CAPX had simply
 * not thought to look for.
 */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return NextResponse.json({ ok: false, error: "bad address" }, { status: 400 });

  try {
    const [balances, usdc, markets, eth] = await Promise.all([
      publicClient.multicall({
        contracts: ASSETS.map((a) => ({
          address: a.token, abi: b20Abi, functionName: "scaledBalanceOf", args: [address as `0x${string}`],
        } as const)),
        allowFailure: true,
      }),
      publicClient.readContract({ address: USDC_BASE, abi: b20Abi, functionName: "balanceOf", args: [address as `0x${string}`] }),
      getMarkets({ depth: 40 }),
      publicClient.getBalance({ address: address as `0x${string}` }),
    ]);

    type Pos = {
      symbol: string; ticker: string; name: string; color: string; token: string;
      qty: number; price: number; change: number; value: number;
      /** Which currency the mark is quoted in where it was bought. */
      currency: "USD" | "TZS";
      /** The shilling mark, for a listing that has one. */
      priceTzs: number | null;
    };

    const positions: Pos[] = ASSETS.map((a, i) => {
      const m = markets.find((x) => x.symbol === a.symbol)!;
      const raw = balances[i].status === "success" ? (balances[i].result as bigint) : 0n;
      const qty = Number(formatUnits(raw, m.decimals));
      return { symbol: a.symbol, ticker: a.ticker, name: a.name, color: a.color, token: a.token,
        qty, price: m.price, change: m.change, value: qty * m.price,
        currency: "USD" as const, priceTzs: null };
    }).filter((p) => p.qty > 0);

    /*
     * The shilling listings.
     *
     * Read with plain balanceOf rather than scaledBalanceOf: these are CAPX's
     * own tokens and carry no multiplier, and asking one for a function it
     * does not implement would fail the whole multicall.
     */
    const { dseSecurities, logoUrl } = await import("@/lib/dseSecurities");
    const dse = await dseSecurities().catch(() => []);
    if (dse.length) {
      const { readOraclePrice } = await import("@/lib/oracle");
      const { getSwapRate, ntzsConfigured } = await import("@/lib/ntzs");
      const usdPerTzs = ntzsConfigured
        ? await getSwapRate("NTZS", "USDC", 100_000)
            .then((r) => { const out = Number(r.expectedOutput ?? 0); return out > 0 ? out / 100_000 : 0; })
            .catch(() => 0)
        : 0;

      await Promise.all(dse.map(async (sec) => {
        try {
          const raw = await publicClient.readContract({
            address: sec.token, abi: b20Abi, functionName: "balanceOf",
            args: [address as `0x${string}`],
          });
          const qty = Number(formatUnits(raw as bigint, sec.decimals));
          if (!(qty > 0)) return;
          const tzs = await readOraclePrice(sec.symbol).then((q) => q?.price ?? 0).catch(() => 0);
          positions.push({
            symbol: sec.symbol, ticker: sec.symbol, name: sec.name,
            color: "#0B7D3E", token: sec.token,
            qty, price: tzs * usdPerTzs, change: 0, value: qty * tzs * usdPerTzs,
            // Carried so the page can show the shilling price it was bought
            // at rather than a dollar figure nobody quoted.
            currency: "TZS", priceTzs: tzs,
          });
          void logoUrl;
        } catch {
          // A token that cannot be read is omitted, not reported as zero:
          // zero is a claim about the balance and an unreadable one is not.
        }
      }));
    }

    const equity = positions.reduce((s, p) => s + p.value, 0);
    const cash = Number(formatUnits(usdc, 6));

    return NextResponse.json({
      ok: true, address, positions, equity, cash, total: equity + cash,
      gas: Number(formatUnits(eth, 18)),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "rpc error" }, { status: 502 });
  }
}
