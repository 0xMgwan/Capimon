import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { balances, history } from "@/lib/ledger";
import { getMarkets } from "@/lib/markets";
import { requireDb, boom } from "@/lib/apiHelpers";
import { ntzsConfigured } from "@/lib/ntzs";
import { treasuryConfigured } from "@/lib/treasury";

export const dynamic = "force-dynamic";

/** The signed-in custodial account: what CAPX holds for them, marked live. */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const [bal, markets, entries] = await Promise.all([
      balances(user.id),
      getMarkets({ depth: 2 }),
      history(user.id, 50),
    ]);

    const cash = bal.find((b) => b.asset === "USDC")?.amount ?? 0;
    const positions = bal
      .filter((b) => b.asset !== "USDC")
      .map((b) => {
        const m = markets.find((x) => x.symbol === b.asset);
        const price = m?.price ?? 0;
        return {
          symbol: b.asset, ticker: m?.ticker ?? b.asset, name: m?.name ?? b.asset,
          color: m?.color ?? "#888", logo: m?.logo ?? null,
          qty: b.amount, price, value: b.amount * price, change: m?.change ?? 0,
        };
      })
      .sort((a, b) => b.value - a.value);

    const equity = positions.reduce((s, p) => s + p.value, 0);
    return NextResponse.json({
      ok: true,
      user,
      cash, positions, equity, total: equity + cash,
      entries,
      capabilities: { ntzs: ntzsConfigured, trading: treasuryConfigured },
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not load your account");
  }
}
