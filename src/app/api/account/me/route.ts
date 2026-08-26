import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { balances, history } from "@/lib/ledger";
import { getMarkets } from "@/lib/markets";
import { requireDb, boom } from "@/lib/apiHelpers";
import { ntzsConfigured, getSwapRate } from "@/lib/ntzs";
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

    // Shilling accounts hold TZS; a legacy USDC balance is still shown.
    const tzs = bal.find((b) => b.asset === "TZS")?.amount ?? 0;
    const cash = bal.find((b) => b.asset === "USDC")?.amount ?? 0;
    const positions = bal
      .filter((b) => b.asset !== "USDC" && b.asset !== "TZS")
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

    // Indicative shilling rate, so a Tanzanian account can be shown in the
    // currency it thinks in. The ledger still holds whatever actually arrived.
    let usdcPerTzs: number | null = null;
    if (ntzsConfigured && cash > 0) {
      try {
        const probe = 100_000;
        const r = await getSwapRate("NTZS", "USDC", probe);
        const out = Number(r.expectedOutput ?? 0);
        if (out > 0) usdcPerTzs = out / probe;
      } catch {
        /* shown in USDC alone when the rate is unavailable */
      }
    }
    return NextResponse.json({
      ok: true,
      user,
      cash, tzs, positions, equity, total: equity + cash,
      usdcPerTzs,
      /** Cash expressed in shillings, when a rate is available. */
      cashTzs: usdcPerTzs && usdcPerTzs > 0 ? cash / usdcPerTzs : null,
      entries,
      capabilities: { ntzs: ntzsConfigured, trading: treasuryConfigured },
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not load your account");
  }
}
