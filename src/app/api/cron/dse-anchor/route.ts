import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { cronPermitted } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Writes yesterday's DSE trades to Base as one number, once.
 *
 * Runs at 00:10 UTC, which is ten past three in the morning in Dar. The day
 * it anchors is the one that closed three hours earlier, and those three
 * hours are the point of the delay rather than an accident of scheduling: a
 * trade placed just before midnight settles shortly after it, and anchoring
 * on the stroke of the hour would fix a root over orders that were still
 * moving.
 *
 * It walks back over the past week rather than anchoring only yesterday. A
 * day that is missed cannot be anchored later by a job that only ever looks
 * one day back — the day is gone and nothing returns for it — so one bad
 * night would leave a permanent hole in the record. This turns that into a
 * late anchor instead, which is a far smaller thing to explain.
 *
 * Cheap on the overwhelmingly common path: six of the seven days are already
 * posted, which is one indexed read each and no chain traffic at all.
 */
export async function POST(req: Request) {
  if (!cronPermitted(req)) {
    return NextResponse.json({ ok: false, error: "not permitted" }, { status: 401 });
  }
  if (!dbConfigured) {
    return NextResponse.json({ ok: true, skipped: "no database" });
  }

  /* One named day, when the desk is filling a gap by hand; otherwise the
     backlog. `?day=` is only reachable with the admin token or the
     scheduler's own header, and anchoring a day twice is refused regardless. */
  const day = new URL(req.url).searchParams.get("day");
  const { anchorDay, anchorBacklog } = await import("@/lib/dseAnchor");

  try {
    const posted = day && /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? [await anchorDay(day)]
      : await anchorBacklog();
    return NextResponse.json({ ok: true, posted },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "anchoring failed" },
      { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
