import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { cronPermitted } from "@/lib/cronAuth";
import { runDue } from "@/lib/recurring";

export const dynamic = "force-dynamic";
/** Two hundred orders, each touching the chain for a price, needs the room. */
export const maxDuration = 300;

/**
 * Places every standing order that has come due.
 *
 * Scheduled hourly rather than once a day so a plan lands close to the time
 * it was promised, and so an hour where the market is halted or the price
 * feed is down does not cost anyone their instalment — the next hour picks it
 * up, because a schedule is only advanced by a run that actually happened.
 *
 * Vercel's scheduler issues GET.
 */
export async function GET(req: Request) {
  if (!cronPermitted(req)) {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });

  try {
    const result = await runDue();
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "recurring run failed" },
      { status: 500 });
  }
}

export const POST = GET;
