import { NextResponse } from "next/server";
import { cronPermitted } from "@/lib/cronAuth";
import { sendDigest, type DigestSlot } from "@/lib/digest";
import { pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The morning and evening portfolio summary.
 *
 * Which one it is comes from the clock in East African time rather than from
 * the query string, so the scheduler cannot be pointed at the wrong slot and
 * a manual run says the same thing the cron would have said. Before 12:00 is
 * the morning note; after it is the close.
 */
function slotNow(): DigestSlot {
  const hourEat = Number(new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", hour12: false,
  }));
  return hourEat < 12 ? "morning" : "evening";
}

export async function GET(req: Request) {
  if (!cronPermitted(req)) {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }
  if (!pushConfigured) {
    return NextResponse.json(
      { ok: false, error: "Push is not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY." },
      { status: 503 });
  }

  const slot = slotNow();
  try {
    const result = await sendDigest(slot);
    return NextResponse.json({ ok: true, slot, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, slot, error: e instanceof Error ? e.message : "digest failed" },
      { status: 500 });
  }
}

export const POST = GET;
