import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { checkSolvency } from "@/lib/solvency";
import { dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

function authorised(req: Request) {
  if (!ADMIN_TOKEN) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Whether client assets are fully backed.
 *
 * Unauthenticated callers get the headline only — anyone trusting CAPX with
 * their money is entitled to know whether it is solvent, but the per-asset
 * position is operational detail. `ADMIN_TOKEN` unlocks the breakdown.
 */
export async function GET(req: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  }
  try {
    const s = await checkSolvency();
    if (!authorised(req)) {
      return NextResponse.json(
        { ok: true, solvent: s.ok, checkedAt: s.checkedAt, unavailable: s.unavailable ?? undefined },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const { ok: solvent, ...detail } = s;
    return NextResponse.json({ ok: true, solvent, ...detail }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "solvency check failed" },
      { status: 502 },
    );
  }
}
