import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { balances, history } from "@/lib/ledger";
import { getMarkets } from "@/lib/markets";
import { requireDb, boom } from "@/lib/apiHelpers";
import { ntzsConfigured, getSwapRate, MIN_TZS_BY_ROUTE } from "@/lib/ntzs";
import { collectionRoute } from "@/lib/omnibus";
import { settlePending } from "@/app/api/ntzs/settle/route";
import { treasuryConfigured } from "@/lib/treasury";

export const dynamic = "force-dynamic";

/** The signed-in custodial account: what CAPX holds for them, marked live. */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    // Opportunistic: credits anything that landed since the last look, so a
    // balance is never stale just because no cron happened to have run.
    await settlePending().catch(() => null);

    const { positionCosts } = await import("@/lib/pnl");
    const [bal, markets, entries, costs] = await Promise.all([
      balances(user.id),
      getMarkets({ depth: 2 }),
      history(user.id, 50),
      positionCosts(user.id),
    ]);

    // Shilling accounts hold TZS; a legacy USDC balance is still shown.
    const tzs = bal.find((b) => b.asset === "TZS")?.amount ?? 0;
    const cash = bal.find((b) => b.asset === "USDC")?.amount ?? 0;
    const positions = bal
      .filter((b) => b.asset !== "USDC" && b.asset !== "TZS")
      .map((b) => {
        const m = markets.find((x) => x.symbol === b.asset);
        const price = m?.price ?? 0;
        // What it cost against what it is worth — the question a holdings
        // list on its own cannot answer.
        const cost = costs.get(b.asset);
        const costBasis = cost && cost.qty > 0 ? cost.avgCost * b.amount : 0;
        const value = b.amount * price;
        return {
          symbol: b.asset, ticker: m?.ticker ?? b.asset, name: m?.name ?? b.asset,
          color: m?.color ?? "#888", logo: m?.logo ?? null,
          qty: b.amount, price, value, change: m?.change ?? 0,
          avgCost: cost?.avgCost ?? 0,
          costBasis,
          pnl: costBasis > 0 ? value - costBasis : 0,
          pnlPct: costBasis > 0 ? ((value - costBasis) / costBasis) * 100 : 0,
          realised: cost?.realised ?? 0,
        };
      })
      .sort((a, b) => b.value - a.value);

    const equity = positions.reduce((s, p) => s + p.value, 0);
    const invested = positions.reduce((s, p) => s + p.costBasis, 0);
    const unrealised = positions.reduce((s, p) => s + p.pnl, 0);
    // Realised gains persist after a position is closed, so they are summed
    // from the cost record rather than from what is currently held.
    const realised = [...costs.values()].reduce((s, c) => s + c.realised, 0);

    // Indicative shilling rate, so a Tanzanian account can be shown in the
    // currency it thinks in. The ledger still holds whatever actually arrived.
    let depositRoute: string | null = null;
    let depositMinTzs = 500;
    if (ntzsConfigured) {
      try {
        depositRoute = await collectionRoute();
        depositMinTzs = MIN_TZS_BY_ROUTE[depositRoute] ?? 500;
      } catch {
        /* the form falls back to the absolute minimum */
      }
    }

    // A rate is needed whenever the account touches shillings — a TZS balance
    // to display, or a USDC balance to show in shillings. A shilling account
    // has cash === 0, so gating on cash alone would hide TZS from exactly the
    // users who hold it.
    let usdcPerTzs: number | null = null;
    if (ntzsConfigured && (cash > 0 || tzs > 0 || depositRoute === "treasury" || depositRoute === "omnibus-wallet")) {
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
      pnl: {
        invested,
        unrealised,
        realised,
        unrealisedPct: invested > 0 ? (unrealised / invested) * 100 : 0,
      },
      usdcPerTzs,
      depositRoute,
      depositMinTzs,
      /** Cash expressed in shillings, when a rate is available. */
      cashTzs: usdcPerTzs && usdcPerTzs > 0 ? cash / usdcPerTzs : null,
      entries,
      capabilities: { ntzs: ntzsConfigured, trading: treasuryConfigured },
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not load your account");
  }
}
