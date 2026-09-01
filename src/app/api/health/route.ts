import { NextResponse } from "next/server";
import { db, dbConfigured, migrate } from "@/lib/db";
import { ntzsConfigured, ntzsLiveMode, getSwapRate } from "@/lib/ntzs";
import { treasuryConfigured, treasuryAddress, treasuryDiagnosis } from "@/lib/treasury";
import { feeEnabled, FEE_BPS } from "@/lib/fees";
import { checkSolvency } from "@/lib/solvency";
import { capabilities, collectionRoute } from "@/lib/omnibus";

export const dynamic = "force-dynamic";

/**
 * What this deployment can actually do, and whether each dependency answers.
 * Reports configuration and reachability separately — "key present" and "key
 * works" are different problems with different fixes.
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    database: { configured: dbConfigured, reachable: null as boolean | null, error: null as string | null },
    ntzs: { configured: ntzsConfigured, liveMode: ntzsLiveMode, rateAvailable: null as boolean | null, error: null as string | null },
    treasury: {
      configured: treasuryConfigured,
      address: treasuryAddress(),
      problem: treasuryDiagnosis(),
      /** Gas balance — the treasury pays for every trade it executes. */
      gasEth: null as number | null,
    },
    fee: { enabled: feeEnabled, bps: FEE_BPS },
  };

  if (dbConfigured) {
    try {
      await migrate();
      const rows = await db()<{ n: string }[]>`
        select count(*)::text as n from information_schema.tables where table_schema = 'capx'`;
      checks.database = { configured: true, reachable: true, tables: Number(rows[0]?.n ?? 0), error: null };
    } catch (e) {
      checks.database = { configured: true, reachable: false, error: e instanceof Error ? e.message.split("\n")[0] : "unreachable" };
    }
  }

  if (treasuryConfigured) {
    try {
      const { formatEther } = await import("viem");
      const { publicClient } = await import("@/lib/chain");
      const wei = await publicClient.getBalance({ address: treasuryAddress()! });
      const t = checks.treasury as Record<string, unknown>;
      t.gasEth = Number(formatEther(wei));
      t.needsGas = Number(formatEther(wei)) < 0.0005;

      /*
       * Reported, not judged.
       *
       * The treasury is a pass-through: a buy sweeps exactly what it needs from
       * the omnibus, spends it, and holds nothing between trades. A near-zero
       * balance here is the design working, so flagging it as "needs capital"
       * would nag about the normal state forever. The number is still worth
       * showing — it is what a trade is funded from.
       */
      const { b20Abi } = await import("@/lib/abis");
      const { USDC_BASE } = await import("@/lib/assets");
      const raw = await publicClient.readContract({
        address: USDC_BASE, abi: b20Abi, functionName: "balanceOf", args: [treasuryAddress()!],
      });
      const { formatUnits } = await import("viem");
      const usdc = Number(formatUnits(raw as bigint, 6));
      t.usdc = usdc;
    } catch {
      /* the address still reports */
    }
  }

  if (ntzsConfigured) {
    const c = checks.ntzs as Record<string, unknown>;
    try {
      await getSwapRate("NTZS", "USDC", 100_000);
      c.rateAvailable = true;
    } catch (e) {
      c.rateAvailable = false;
      c.error = e instanceof Error ? e.message : "rate unavailable";
    }
    // Capabilities are granted per partner, so the only honest way to know what
    // this key can do is to ask.
    try {
      c.capabilities = await capabilities();
      c.collectionRoute = await collectionRoute();
    } catch (e) {
      c.capabilities = { error: e instanceof Error ? e.message : "probe failed" };
    }

    // Which identity fields are configured for the omnibus — booleans and the
    // externalId only, never the NIDA itself. Distinguishes "the env var is
    // missing" from "nTZS was given it and still withheld the wallet", which
    // otherwise look identical from outside.
    try {
      const { omnibusIdentityConfigured } = await import("@/lib/omnibus");
      c.omnibusIdentity = omnibusIdentityConfigured;
    } catch { /* not fatal */ }

    // Raw ramp balance, so the float's real field names are visible — solvency
    // must count this USDC as backing and had been reading it as zero.
    try {
      const { rampBalance } = await import("@/lib/ntzs");
      c.rampBalanceRaw = await rampBalance();
    } catch (e) {
      c.rampBalanceRaw = { error: e instanceof Error ? e.message : "unavailable" };
    }

    // The omnibus needs an actual wallet for deposits to land and for buys to
    // swap — a user record alone is rejected. Report readiness (a boolean, not
    // the address) so a setup gap is visible before someone tries to deposit.
    // Attempted on every route, not just the wallet one: this is the call that
    // provisions and attests the account, so gating it behind the route it
    // enables would mean it never runs.
    try {
      const { omnibusUserId, omnibusBalances } = await import("@/lib/omnibus");
      await omnibusUserId();
      const b = await omnibusBalances();
      c.omnibusWalletReady = !!b.walletAddress;
      // CAPX's own float, not customer data. Distinguishes "the omnibus is
      // short" from "the swap was refused", which read identically from a 400.
      c.omnibusBalances = { tzs: b.tzs, usdc: b.usdc };
    } catch (e) {
      c.omnibusWalletReady = false;
      c.omnibusWalletError = e instanceof Error ? e.message : "omnibus wallet unavailable";
    }
  }

  if (dbConfigured && treasuryConfigured) {
    try {
      const s = await checkSolvency();
      checks.solvency = {
        solvent: s.ok,
        owedUsd: Number(s.totals.owedUsd.toFixed(2)),
        heldUsd: Number(s.totals.heldUsd.toFixed(2)),
        shortfallUsd: Number(s.totals.shortfallUsd.toFixed(2)),
        unavailable: s.unavailable ?? null,
        // Per asset, so a shortfall says which leg is short instead of only
        // that one exists. These are totals across all accounts — no customer
        // appears in them — and without it every diagnosis needed the admin
        // token and a round trip through someone who has it.
        assets: s.assets.map((a) => ({
          asset: a.asset,
          owed: Number(a.owed.toFixed(6)),
          held: Number(a.held.toFixed(6)),
          covered: a.covered,
        })),
        usdc: s.usdc,
      };
    } catch (e) {
      checks.solvency = { solvent: null, error: e instanceof Error ? e.message : "check failed" };
    }
  }

  /*
   * The last few orders, without who placed them.
   *
   * Aggregate balances say a shortfall exists but not which order caused it,
   * and every diagnosis so far has needed the admin token and a round trip.
   * Side, size and outcome are enough to see what a trade thought it was doing;
   * no customer appears here.
   */
  if (dbConfigured) {
    try {
      const rows = await db()<{ side: string; symbol: string; usdc_amount: string | null;
                                qty: string | null; status: string; error: string | null;
                                created_at: string }[]>`
        select side, symbol, usdc_amount::text, qty::text, status,
               left(coalesce(error, ''), 120) as error, created_at
          from capx.orders order by created_at desc limit 8`;
      checks.recentOrders = rows;
    } catch { /* not fatal */ }
  }

  const ready = dbConfigured && ntzsConfigured && treasuryConfigured;
  return NextResponse.json(
    {
      ok: true,
      custodialReady: ready,
      // Which commit is actually serving. Without this, "is the fix live yet?"
      // can only be guessed at, and a stale deploy looks exactly like a bug
      // that was never fixed.
      build: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
      checks,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
