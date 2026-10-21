import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db, migrate, dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Records that somebody accepted the sandbox disclosure.
 *
 * The browser remembers it too, so the notice does not nag — but a key in
 * localStorage is a convenience, not a record. It belongs to one browser,
 * survives nothing, and proves nothing to anybody asking when a customer was
 * told what they were buying into. This is the part that is actually a record.
 *
 * Anonymous callers are answered rather than refused. The notice shows on a
 * public page, most of the people reading it have no account, and failing
 * their acceptance loudly would only teach the client to ignore the response.
 */
export async function POST() {
  if (!dbConfigured) return NextResponse.json({ ok: true, recorded: false });

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: true, recorded: false });

    await migrate();
    /* First acceptance wins: re-accepting should not rewrite the date a
       regulator would ask about. */
    await db()`
      update capx.users set sandbox_accepted_at = coalesce(sandbox_accepted_at, now())
       where id = ${user.id}::uuid`;
    return NextResponse.json({ ok: true, recorded: true });
  } catch {
    /* The acknowledgement is not worth failing somebody's page over. */
    return NextResponse.json({ ok: true, recorded: false });
  }
}
