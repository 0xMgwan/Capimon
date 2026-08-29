import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listNotifications, markAllRead } from "@/lib/notify";
import { requireDb, boom } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/** What has happened to this account's money, newest first. */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
    const items = await listNotifications(user.id);
    return NextResponse.json(
      { ok: true, items, unread: items.filter((i) => !i.read_at).length },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return boom(e, "Could not load your notifications");
  }
}

/** Marks everything read — opening the list is the acknowledgement. */
export async function POST() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
    await markAllRead(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return boom(e, "Could not update your notifications");
  }
}
