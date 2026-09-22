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
        from capx.securities
       -- A draft is not public: the desk says so, and this is where it holds.
       where status <> 'draft'
       order by (symbol = 'CRDB') desc, symbol`;

    const securities = await Promise.all(rows.map(async (r) => {
      // The logo is served on its own route; inlining it would put tens of
      // kilobytes of base64 into every read of this list.
      const { logo, ...metadata } = (r.metadata ?? {}) as Record<string, unknown>;
      const kind = metadata.kind === "external" ? "external" : "dse";
      /* An external listing is backed by what the treasury holds, not by an
         attestation, so its holding is reported alongside. */
      let held: number | null = null;
      if (kind === "external") {
        const { treasuryHoldings } = await import("@/lib/treasury");
        const t = await treasuryHoldings().catch(() => null);
        held = t?.holdings.find((h) => h.asset === r.symbol)?.qty ?? 0;
      }
      return {
        ...r, metadata, hasLogo: !!logo, kind,
        issuer: (metadata.issuer as string) ?? null, venue: (metadata.venue as string) ?? null,
        buyOnly: metadata.buyOnly === true, held,
        backing: await backing(r.symbol),
      };
    }));

    return NextResponse.json({ ok: true, securities }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not load securities" },
      { status: 500 },
    );
  }
}
