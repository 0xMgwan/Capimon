import { NextResponse } from "next/server";
import { withdrawalBanks, ntzsConfigured } from "@/lib/ntzs";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The only bank codes the nTZS docs name. Used when the bank list cannot be
 * read, so a customer can still pay out to the largest banks rather than
 * facing an empty picker.
 */
const DOCUMENTED = [
  { code: "CRDB", name: "CRDB Bank" },
  { code: "NMB", name: "NMB Bank" },
  { code: "NBC", name: "NBC Bank" },
];

let cache: { at: number; banks: { code: string; name: string }[] } | null = null;

/** Banks a withdrawal can go to, cached for an hour. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

  if (!cache || Date.now() - cache.at > 3600_000) {
    const banks = ntzsConfigured ? await withdrawalBanks().catch(() => []) : [];
    if (banks.length) cache = { at: Date.now(), banks };
  }
  const banks = cache?.banks ?? DOCUMENTED;
  return NextResponse.json({ ok: true, banks, source: cache ? "ntzs" : "documented" },
    { headers: { "cache-control": "no-store" } });
}
