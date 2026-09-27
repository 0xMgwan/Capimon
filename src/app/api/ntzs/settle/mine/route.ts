import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { settlePending } from "../route";

export const dynamic = "force-dynamic";

/**
 * Settle this customer's own deposits, now.
 *
 * The cron sweep runs every fifteen minutes. That is the right cadence for
 * making sure nothing is ever missed and a miserable one for somebody who has
 * just approved a prompt on their phone and is watching a spinner — the money
 * had often arrived at nTZS within seconds and simply had nobody looking.
 *
 * This is the same settlement, scoped to one account and triggered by the
 * page that is already open. It is not a shortcut: the credit still depends
 * on nTZS saying the money is there, and a caller cannot influence the answer
 * by asking more often. All they can do is cause us to look sooner.
 *
 * Rate limited per account, because "look sooner" is only worth anything the
 * first time in a few seconds and the upstream has its own opinion about how
 * often it likes being asked.
 */
const MIN_GAP_MS = 4_000;
const lastCheck = new Map<string, number>();

export async function POST() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return bad("Sign in first.", "unauthorised", 401);

    const now = Date.now();
    const previous = lastCheck.get(user.id) ?? 0;
    if (now - previous < MIN_GAP_MS) {
      // Not an error: the caller polls, and being told "too soon" is the
      // normal reply most of the time.
      return NextResponse.json({ ok: true, skipped: true });
    }
    lastCheck.set(user.id, now);

    const result = await settlePending(user.id);
    return NextResponse.json(
      { ok: true, checked: result.checked },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return boom(e, "Could not check your deposit");
  }
}
