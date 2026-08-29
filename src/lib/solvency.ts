import "server-only";
import { totalLiabilities } from "./ledger";
import { treasuryHoldings, treasuryConfigured } from "./treasury";
import { getMarkets } from "./markets";
import { rampBalance, ntzsConfigured, getSwapRate } from "./ntzs";

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
  /** Where the USDC actually sits, since it backs balances from two places. */
  usdc: { treasury: number; rampFloat: number };
  /** Present when solvency could not be established, which is not the same as insolvent. */
  unavailable?: string;
};

export async function checkSolvency(): Promise<Solvency> {
  const checkedAt = Math.floor(Date.now() / 1000);
  if (!treasuryConfigured) {
    return { ok: false, checkedAt, assets: [], totals: { owedUsd: 0, heldUsd: 0, shortfallUsd: 0 },
      usdc: { treasury: 0, rampFloat: 0 }, unavailable: "No treasury is configured." };
  }

  const [liabilities, holdings, markets, float, ntzsTzs] = await Promise.all([
    totalLiabilities(),
    treasuryHoldings(),
    getMarkets({ depth: 2 }),
    // On-ramped USDC is delivered to the nTZS settlement float, not to the
    // Base treasury. It is still CAPX's money and still backs client balances,
    // so leaving it out reported a shortfall that did not exist.
    ntzsConfigured ? rampBalance().then((b) => Number(b.usdcBalance ?? b.balance ?? b.usdc ?? 0)).catch(() => 0) : 0,
    // Shilling accounts hold TZS until they buy, so client TZS balances are
    // backed by the shillings sitting in the nTZS omnibus, not by anything
    // onchain. Read it so a TZS liability is checked against a real holding.
    ntzsConfigured
      ? import("./omnibus").then((m) => m.omnibusBalances()).then((b) => b.tzs).catch(() => 0)
      : 0,
  ]);
  if (!holdings) {
    return { ok: false, checkedAt, assets: [], totals: { owedUsd: 0, heldUsd: 0, shortfallUsd: 0 },
      usdc: { treasury: 0, rampFloat: 0 }, unavailable: "Treasury holdings could not be read." };
  }

  // Coverage per asset is checked in the asset's own units (owed TZS vs held
  // TZS), so the trading gate never depends on a rate. This USD value is only
  // for the reported totals — a stale or missing rate cannot mask a shortfall.
  let tzsUsd = 0;
  if (ntzsConfigured && (liabilities.some((l) => l.asset === "TZS") || ntzsTzs > 0)) {
    try {
      const r = await getSwapRate("NTZS", "USDC", 100_000);
      const out = Number(r.expectedOutput ?? 0);
      if (out > 0) tzsUsd = out / 100_000;
    } catch { /* TZS shown at 0 USD in totals; coverage unaffected */ }
  }

  const priceOf = (asset: string) =>
    asset === "USDC" ? 1 : asset === "TZS" ? tzsUsd : markets.find((m) => m.symbol === asset)?.price ?? 0;

  const heldOf = (asset: string) =>
    asset === "USDC" ? holdings.usdc + float
    : asset === "TZS" ? ntzsTzs
    : holdings.holdings.find((h) => h.asset === asset)?.qty ?? 0;

  // Every asset either side knows about, so a holding with no liability shows
  // up too — that is a surplus, and worth seeing.
  const names = [...new Set([...liabilities.map((l) => l.asset), "USDC",
    ...holdings.holdings.map((h) => h.asset)])];

  /*
   * Shillings and dollars are one pool, shares are not.
   *
   * TZS and USDC are convertible on demand — the buy path swaps between them on
   * every shilling order — so holding 3,000 TZS while a quarter of a dollar
   * short of USDC is a composition to correct, not a shortfall. Judged per
   * asset it read as insolvency and paused trading for everyone, with more
   * value held than owed.
   *
   * Shares stay strict: a missing share cannot be conjured from cash at a
   * guaranteed price, and pretending otherwise would hide a real hole.
   */
  const isCash = (asset: string) => asset === "USDC" || asset === "TZS";
  const cashOwedUsd = names.filter(isCash)
    .reduce((sum, a) => sum + (liabilities.find((l) => l.asset === a)?.amount ?? 0) * priceOf(a), 0);
  const cashHeldUsd = names.filter(isCash).reduce((sum, a) => sum + heldOf(a) * priceOf(a), 0);
  const cashGapUsd = cashOwedUsd - cashHeldUsd;
  const cashCovered = !(cashGapUsd > ABSOLUTE_DUST && cashGapUsd > cashOwedUsd * TOLERANCE);

  const assets: AssetSolvency[] = names.map((asset) => {
    const owed = liabilities.find((l) => l.asset === asset)?.amount ?? 0;
    const held = heldOf(asset);

    if (isCash(asset)) {
      // Attribute any real cash gap to the leg that is actually short, so the
      // admin view still points at what to convert.
      const short = !cashCovered && owed > held ? owed - held : 0;
      return { asset, owed, held, shortfall: short, covered: cashCovered, valueUsd: owed * priceOf(asset) };
    }

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
    usdc: { treasury: holdings.usdc, rampFloat: float },
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
