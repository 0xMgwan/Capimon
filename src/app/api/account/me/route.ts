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
    /*
     * CRDB is priced separately from the rest.
     *
     * Everything else in this list comes from a Chainlink feed in dollars;
     * CRDB comes from our own oracle in shillings. Without this it would fall
     * through `markets.find` as an unpriced holding worth nothing — the
     * customer would see the shares they just bought valued at zero, and the
     * portfolio total would quietly omit them.
     */
    const [bal, markets, entries, costs, crdbTzs, tzsRate] = await Promise.all([
      balances(user.id),
      getMarkets({ depth: 2 }),
      history(user.id, 50),
      positionCosts(user.id),
      import("@/lib/oracle").then((m) => m.readOraclePrice("CRDB")).then((q) => q?.price ?? 0).catch(() => 0),
      ntzsConfigured
        ? getSwapRate("NTZS", "USDC", 100_000)
            .then((r) => { const o = Number(r.expectedOutput ?? 0); return o > 0 ? o / 100_000 : 0; })
            .catch(() => 0)
        : Promise.resolve(0),
    ]);

    /** CRDB in dollars, so one equity total can hold both markets. */
    const crdbUsd = crdbTzs > 0 && tzsRate > 0 ? crdbTzs * tzsRate : 0;

    // Shilling accounts hold TZS; a legacy USDC balance is still shown.
    const tzs = bal.find((b) => b.asset === "TZS")?.amount ?? 0;
    const cash = bal.find((b) => b.asset === "USDC")?.amount ?? 0;
    /*
     * Dust is not a position.
     *
     * A few millionths of a share left over from selling "everything" prices to
     * zero and cannot be sold for anything, but it occupied a row that looked
     * like a holding. It stays in the ledger — nothing is written off — it
     * simply stops being shown as something the account owns.
     */
    const DUST = 0.001;
    const positions = bal
      .filter((b) => b.asset !== "USDC" && b.asset !== "TZS" && Math.abs(b.amount) >= DUST)
      .map((b) => {
        const m = markets.find((x) => x.symbol === b.asset);
        const isCrdb = b.asset === "CRDB";
        const price = isCrdb ? crdbUsd : m?.price ?? 0;
        // What it cost against what it is worth — the question a holdings
        // list on its own cannot answer.
        const cost = costs.get(b.asset);
        /*
         * Cost is held in the currency it was paid in, so it is converted here
         * — the one place two markets have to share a column. Using today's
         * rate is an approximation of a historical one, but the alternative was
         * reading 2,980 shillings as 2,980 dollars, which showed a holder of a
         * third of a share down ninety-nine per cent.
         */
        const toUsd = cost?.currency === "TZS" ? tzsRate : 1;
        const avgCostUsd = (cost?.avgCost ?? 0) * toUsd;
        const costBasis = cost && cost.qty > 0 ? avgCostUsd * b.amount : 0;
        const value = b.amount * price;
        return {
          symbol: b.asset,
          ticker: isCrdb ? "CRDB" : m?.ticker ?? b.asset,
          name: isCrdb ? "CRDB Bank Plc" : m?.name ?? b.asset,
          color: isCrdb ? "#0B7D3E" : m?.color ?? "#888",
          logo: isCrdb ? "/crdb.jpg" : m?.logo ?? null,
          qty: b.amount, price, value, change: m?.change ?? 0,
          avgCost: avgCostUsd,
          // Also in what was actually paid, so a shilling account can be shown
          // the number it recognises instead of a conversion of it.
          avgCostNative: cost?.avgCost ?? 0,
          currency: cost?.currency ?? "USD",
          costBasis,
          pnl: costBasis > 0 ? value - costBasis : 0,
          pnlPct: costBasis > 0 ? ((value - costBasis) / costBasis) * 100 : 0,
          realised: (cost?.realised ?? 0) * toUsd,
        };
      })
      .sort((a, b) => b.value - a.value);

    const equity = positions.reduce((s, p) => s + p.value, 0);
    const invested = positions.reduce((s, p) => s + p.costBasis, 0);
    const unrealised = positions.reduce((s, p) => s + p.pnl, 0);
    // Realised gains persist after a position is closed, so they are summed
    // from the cost record rather than from what is currently held.
    const realised = [...costs.values()].reduce(
      (s, c) => s + c.realised * (c.currency === "TZS" ? tzsRate : 1), 0);

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
    let usdcPerTzs: number | null = tzsRate > 0 ? tzsRate : null;
    if (usdcPerTzs === null && ntzsConfigured && (cash > 0 || tzs > 0 || depositRoute === "treasury" || depositRoute === "omnibus-wallet")) {
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
