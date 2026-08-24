import { NextResponse } from "next/server";
import { formatUnits, isAddress } from "viem";
import { ASSETS, USDC_BASE } from "@/lib/assets";
import { b20Abi } from "@/lib/abis";
import { publicClient } from "@/lib/chain";
import { getMarkets } from "@/lib/markets";

export const dynamic = "force-dynamic";

/** Real B20 balances for a wallet on Base, valued at the live Chainlink mark. */
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

    const positions = ASSETS.map((a, i) => {
      const m = markets.find((x) => x.symbol === a.symbol)!;
      const raw = balances[i].status === "success" ? (balances[i].result as bigint) : 0n;
      const qty = Number(formatUnits(raw, m.decimals));
      return { symbol: a.symbol, ticker: a.ticker, name: a.name, color: a.color, token: a.token,
        qty, price: m.price, change: m.change, value: qty * m.price };
    }).filter((p) => p.qty > 0);

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
