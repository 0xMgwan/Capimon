import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { saveSubscription, removeSubscription, subscriptionCount, pushConfigured, pushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Whether push is available at all, and whether this account already has it. */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
    return NextResponse.json(
      { ok: true, configured: pushConfigured, devices: await subscriptionCount(user.id) },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not read your notification settings");
  }
}

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    if (body.action === "unsubscribe") {
      const endpoint = String(body.endpoint ?? "");
      if (endpoint) await removeSubscription(endpoint);
      return NextResponse.json({ ok: true, devices: await subscriptionCount(user.id) });
    }

    /*
     * A test send, so somebody can tell the difference between "notifications
     * are on" and "notifications are on and actually arrive". Those are not
     * the same thing, and the gap between them is a browser permission
     * dialogue somebody dismissed.
     */
    if (body.action === "test") {
      const sent = await pushToUser(user.id, {
        title: "Notifications are on",
        body: "This is how CAPX will tell you about your money.",
        url: "/portfolio",
        tag: "capx-test",
      });
      return NextResponse.json({ ok: true, sent });
    }

    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return bad("That is not a push subscription.");
    }
    await saveSubscription(user.id, sub, req.headers.get("user-agent"));
    return NextResponse.json({ ok: true, devices: await subscriptionCount(user.id) });
  } catch (e) {
    return boom(e, "Could not save your notification settings");
  }
}
