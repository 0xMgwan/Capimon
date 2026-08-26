import { NextResponse } from "next/server";
import { db, dbConfigured, migrate } from "@/lib/db";
import { ntzsConfigured, ntzsLiveMode, getSwapRate } from "@/lib/ntzs";
import { treasuryConfigured, treasuryAddress } from "@/lib/treasury";
import { feeEnabled, FEE_BPS } from "@/lib/fees";

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
    treasury: { configured: treasuryConfigured, address: treasuryAddress() },
    fee: { enabled: feeEnabled, bps: FEE_BPS },
  };

  if (dbConfigured) {
    try {
      await migrate();
      const rows = await db()<{ n: string }[]>`
        select count(*)::text as n from information_schema.tables where table_schema = 'capimon'`;
      checks.database = { configured: true, reachable: true, tables: Number(rows[0]?.n ?? 0), error: null };
    } catch (e) {
      checks.database = { configured: true, reachable: false, error: e instanceof Error ? e.message.split("\n")[0] : "unreachable" };
    }
  }

  if (ntzsConfigured) {
    try {
      await getSwapRate("NTZS", "USDC", 100_000);
      (checks.ntzs as Record<string, unknown>).rateAvailable = true;
    } catch (e) {
      const c = checks.ntzs as Record<string, unknown>;
      c.rateAvailable = false;
      c.error = e instanceof Error ? e.message : "rate unavailable";
    }
  }

  const ready = dbConfigured && ntzsConfigured && treasuryConfigured;
  return NextResponse.json(
    { ok: true, custodialReady: ready, checks },
    { headers: { "cache-control": "no-store" } },
  );
}
