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
      };
    } catch (e) {
      checks.solvency = { solvent: null, error: e instanceof Error ? e.message : "check failed" };
    }
  }

  const ready = dbConfigured && ntzsConfigured && treasuryConfigured;
  return NextResponse.json(
    { ok: true, custodialReady: ready, checks },
    { headers: { "cache-control": "no-store" } },
  );
}
