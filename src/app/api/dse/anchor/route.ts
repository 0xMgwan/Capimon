import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { viewerOf, ACTOR } from "@/lib/adminAuth";
import { manifest } from "@/lib/dseAnchor";
import { recordView } from "@/lib/dseOversight";

export const dynamic = "force-dynamic";

/**
 * One anchored day, opened up so the root can be re-derived by hand.
 *
 * An anchor nobody can recompute is decoration, and recomputing it needs the
 * exact line behind each leaf — not a formatted version of the figures, the
 * line itself. So this hands over the canonical strings, the leaves and the
 * root, and anybody with a SHA-256 implementation can get from the trades to
 * the number on Base without running CAPX's code or trusting CAPX's
 * arithmetic.
 *
 * Nothing here names a person. The manifest carries the same fields the root
 * was built from, and who placed a trade was never one of them — a leaf that
 * could be linked back to a customer is the one kind that must not exist
 * when the root goes onchain in public.
 */
export async function GET(req: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  }
  const role = viewerOf(req);
  if (!role) {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }

  const day = (new URL(req.url).searchParams.get("day") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json(
      { ok: false, code: "bad_day", error: "Ask for a day as YYYY-MM-DD." }, { status: 400 });
  }

  try {
    const out = await manifest(day);
    /* Logged like any other read, though it names nobody: the access trail
       is only trustworthy if it is complete. */
    await recordView({
      actor: ACTOR[role], action: "anchor.manifest", subject: day,
      detail: { trades: out.count, matches: out.matches }, req,
    }).catch(() => {});
    return NextResponse.json({ ok: true, actor: ACTOR[role], ...out },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "could not build the manifest" },
      { status: 500 });
  }
}
