import { NextResponse } from "next/server";
import { roleOf } from "@/lib/adminAuth";
import { requireDb, boom } from "@/lib/apiHelpers";
import { applyCorporateActions, corporateActionLog } from "@/lib/corporateActions";

export const dynamic = "force-dynamic";

/**
 * Dividends and splits, on the desk's own schedule as well as the cron's.
 *
 * The scheduled run catches one the same morning it lands, which is soon
 * enough for something that happens a few times a year. This exists for the
 * first run and for the days somebody wants to see it happen — reading the
 * chain, distributing what is outstanding, and reporting exactly what moved.
 *
 * Safe to press twice: every credit is keyed to the symbol, the multiplier
 * and the holder, and the ledger's ref index is unique. A second press writes
 * nothing and says so by reporting no holders credited.
 */
export async function GET(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (roleOf(req) !== "admin") {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, log: await corporateActionLog() });
  } catch (e) {
    return boom(e, "Could not read the corporate action log");
  }
}

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (roleOf(req) !== "admin") {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, applied: await applyCorporateActions() });
  } catch (e) {
    return boom(e, "Could not apply corporate actions");
  }
}
