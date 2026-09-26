import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { userActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * One customer's own record of what happened to their money.
 *
 * Never cached and never public: this is the most identifying thing the app
 * holds about somebody — what they bought, what it cost, which number the
 * money came from — and it is served only to the session that owns it.
 */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return bad("Sign in first.", "unauthorised", 401);
    return NextResponse.json(
      { ok: true, items: await userActivity(user.id) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return boom(e, "Could not load your activity");
  }
}
