import { NextResponse } from "next/server";
import { withdrawalBanksDetailed, ntzsConfigured } from "@/lib/ntzs";
import { currentUser } from "@/lib/auth";
import { roleOf } from "@/lib/adminAuth";
import { TZ_BANK_CANDIDATES } from "@/lib/tzBanks";

export const dynamic = "force-dynamic";


/*
 * Selcom's own published list, which is the rail nTZS pays banks over.
 *
 * Used directly rather than as a last resort: nTZS exposes no bank endpoint,
 * so there is nothing to prefer over it until the desk has probed which
 * codes the rail accepts — and that probe only narrows this list, never
 * replaces it with something better sourced.
 *
 * The duplicate short forms are dropped here: a picker offering CRDB Bank
 * twice under two codes asks the customer a question they cannot answer.
 */
const DOCUMENTED = (() => {
  const seen = new Set<string>();
  return TZ_BANK_CANDIDATES.filter((b) => {
    const key = b.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
})();

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

  /*
   * Codes nTZS has confirmed, when the desk has probed for them.
   *
   * They come first: an endpoint that does not exist cannot be waited for,
   * and a list the rail itself accepted is better than three names from a
   * paragraph.
   */
  const { verifiedBanks } = await import("@/lib/bankProbe");
  const verified = await verifiedBanks().catch(() => []);
  if (verified.length) {
    return NextResponse.json({ ok: true, banks: verified, source: "verified" },
      { headers: { "cache-control": "no-store" } });
  }

  let tried: { path: string; outcome: string }[] = [];
  let sample: Record<string, unknown> | null = null;
  if (!cache || Date.now() - cache.at > 3600_000) {
    const r = ntzsConfigured
      ? await withdrawalBanksDetailed().catch(() => ({ banks: [], tried: [{ path: "*", outcome: "lookup threw" }], sample: null }))
      : { banks: [], tried: [{ path: "*", outcome: "nTZS is not configured" }], sample: null };
    tried = r.tried;
    sample = r.sample ?? null;
    if (r.banks.length) cache = { at: Date.now(), banks: r.banks };
  }
  const banks = cache?.banks ?? DOCUMENTED;
  return NextResponse.json({
    ok: true, banks, source: cache ? "ntzs" : "selcom",
    /*
     * Why the list is short, for a desk only.
     *
     * A customer does not need to know which upstream path answered what;
     * an operator looking at three banks in a country with thirty-eight
     * does, and the alternative is guessing.
     */
    ...(roleOf(req) && !cache ? { tried, sample } : {}),
  }, { headers: { "cache-control": "no-store" } });
}
