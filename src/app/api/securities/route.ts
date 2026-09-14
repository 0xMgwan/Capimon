import { NextResponse } from "next/server";
import { db, migrate, dbConfigured } from "@/lib/db";
import { backing } from "@/lib/custody";

export const dynamic = "force-dynamic";

/**
 * Every tokenised security and how well it is backed.
 *
 * Public on purpose. A custodial claim that only its issuer can audit asks to
 * be taken on trust; publishing owed against held, live, is the one thing that
 * makes the arrangement checkable by the people bearing the risk.
 */
export async function GET() {
  if (!dbConfigured) return NextResponse.json({ ok: true, securities: [] });
  try {
    await migrate();
    const rows = await db()<{ symbol: string; name: string; token_address: string | null;
                              decimals: number; chain_id: number; status: string;
                              metadata: Record<string, unknown> }[]>`
      select symbol, name, token_address, decimals, chain_id, status, metadata
        from capx.securities order by symbol`;

    const securities = await Promise.all(rows.map(async (r) => ({
      ...r,
      backing: await backing(r.symbol),
    })));

    return NextResponse.json({ ok: true, securities }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not load securities" },
      { status: 500 },
    );
  }
}
