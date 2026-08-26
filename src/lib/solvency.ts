import "server-only";
import { totalLiabilities } from "./ledger";
import { treasuryHoldings, treasuryConfigured } from "./treasury";
import { getMarkets } from "./markets";

/**
 * Solvency: does the treasury actually hold what the ledger says clients are
 * owed?
 *
 * This is the one number that matters in a custodial system. It is exposed as a
 * check rather than only a page, because a dashboard nobody opens protects
 * nobody — `assertSolvent` runs before every order, so a shortfall stops new
 * trading instead of quietly deepening.
 */

/** Dust tolerance. Share quantities carry 8 decimals and rounding is real. */
const TOLERANCE = 0.005; // 0.5%
const ABSOLUTE_DUST = 0.01;

export type AssetSolvency = {
  asset: string;
  owed: number;
  held: number;
  shortfall: number;
  covered: boolean;
  valueUsd: number;
};

export type Solvency = {
  ok: boolean;
  checkedAt: number;
  assets: AssetSolvency[];
  totals: { owedUsd: number; heldUsd: number; shortfallUsd: number };
  /** Present when solvency could not be established, which is not the same as insolvent. */
  unavailable?: string;
};

export async function checkSolvency(): Promise<Solvency> {
  const checkedAt = Math.floor(Date.now() / 1000);
  if (!treasuryConfigured) {
    return { ok: false, checkedAt, assets: [], totals: { owedUsd: 0, heldUsd: 0, shortfallUsd: 0 },
      unavailable: "No treasury is configured." };
  }

  const [liabilities, holdings, markets] = await Promise.all([
    totalLiabilities(),
    treasuryHoldings(),
    getMarkets({ depth: 2 }),
  ]);
  if (!holdings) {
    return { ok: false, checkedAt, assets: [], totals: { owedUsd: 0, heldUsd: 0, shortfallUsd: 0 },
      unavailable: "Treasury holdings could not be read." };
  }

  const priceOf = (asset: string) =>
    asset === "USDC" ? 1 : markets.find((m) => m.symbol === asset)?.price ?? 0;

  const heldOf = (asset: string) =>
    asset === "USDC" ? holdings.usdc : holdings.holdings.find((h) => h.asset === asset)?.qty ?? 0;

  // Every asset either side knows about, so a holding with no liability shows
  // up too — that is a surplus, and worth seeing.
  const names = [...new Set([...liabilities.map((l) => l.asset), "USDC",
    ...holdings.holdings.map((h) => h.asset)])];

  const assets: AssetSolvency[] = names.map((asset) => {
    const owed = liabilities.find((l) => l.asset === asset)?.amount ?? 0;
    const held = heldOf(asset);
    const rawShortfall = owed - held;
    // Ignore dust: a few wei of rounding is not an insolvency.
    const shortfall = rawShortfall > ABSOLUTE_DUST && rawShortfall > owed * TOLERANCE ? rawShortfall : 0;
    return { asset, owed, held, shortfall, covered: shortfall === 0, valueUsd: owed * priceOf(asset) };
  }).sort((a, b) => b.valueUsd - a.valueUsd);

  const owedUsd = assets.reduce((s, a) => s + a.owed * priceOf(a.asset), 0);
  const heldUsd = assets.reduce((s, a) => s + a.held * priceOf(a.asset), 0);
  const shortfallUsd = assets.reduce((s, a) => s + a.shortfall * priceOf(a.asset), 0);

  return {
    ok: assets.every((a) => a.covered),
    checkedAt, assets,
    totals: { owedUsd, heldUsd, shortfallUsd },
  };
}

/**
 * Circuit breaker. Throws when client assets are not fully backed, so an order
 * cannot deepen a shortfall. Being unable to check is treated as unsafe: a
 * custodial system that cannot prove it is solvent should not take new orders.
 */
export async function assertSolvent() {
  const s = await checkSolvency();
  if (s.unavailable) throw new Error(`Solvency could not be verified — ${s.unavailable}`);
  if (!s.ok) {
    const worst = s.assets.filter((a) => !a.covered).map((a) => a.asset).join(", ");
    throw new Error(
      `Trading is paused: client holdings are not fully backed (${worst}). No new orders are accepted until this is resolved.`,
    );
  }
  return s;
}
