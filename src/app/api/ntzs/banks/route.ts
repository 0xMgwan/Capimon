import { NextResponse } from "next/server";
import { withdrawalBanks, ntzsConfigured } from "@/lib/ntzs";
import { currentUser } from "@/lib/auth";
import { roleOf } from "@/lib/adminAuth";

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
export async function GET(req: Request) {
  /*
   * A signed-in customer, or a desk.
   *
   * This used to want a customer session and nothing else, so the broker's
   * payout form — which authenticates with a token, not a cookie — got a 401
   * and rendered an empty bank picker with no way to tell that was why. The
   * list is the same list either way; it is not customer data.
   */
  const user = await currentUser();
  if (!user && !roleOf(req)) {
    return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
  }

  if (!cache || Date.now() - cache.at > 3600_000) {
    const banks = ntzsConfigured ? await withdrawalBanks().catch(() => []) : [];
    if (banks.length) cache = { at: Date.now(), banks };
  }
  const banks = cache?.banks ?? DOCUMENTED;
  return NextResponse.json({ ok: true, banks, source: cache ? "ntzs" : "documented" },
    { headers: { "cache-control": "no-store" } });
}
