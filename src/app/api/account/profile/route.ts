import { NextResponse } from "next/server";
import { db, migrate } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/** Letters, digits and underscore — what reads as a handle and survives a URL. */
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * An avatar is stored as a resized data URL on the row.
 *
 * The client shrinks the image to 128px before sending, so this is a few
 * kilobytes; the cap is here rather than only there because a client-side limit
 * is a courtesy, not a control. Anything larger is refused outright rather than
 * silently truncated into a broken image.
 */
const MAX_AVATAR_BYTES = 120_000;

/** Updates the parts of an account its owner is allowed to change. */
export async function PATCH(req: Request) {
  const gate = requireDb();
  if (gate) return gate;

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    await migrate();
    const sql = db();

    // Only the fields actually supplied are touched, so saving one thing from
    // one screen cannot blank another that was never on it.
    const patch: Record<string, string | null> = {};

    if (body.username !== undefined) {
      const username = String(body.username ?? "").trim();
      if (username && !USERNAME_RE.test(username)) {
        return bad("A username is 3–20 characters, using letters, numbers or underscore.");
      }
      if (username) {
        const taken = await sql<{ id: string }[]>`
          select id::text from capx.users
           where lower(username) = ${username.toLowerCase()} and id <> ${user.id} limit 1`;
        if (taken.length) return bad("That username is already taken.", "username_taken");
      }
      patch.username = username || null;
    }

    if (body.name !== undefined) patch.name = String(body.name ?? "").trim().slice(0, 80) || null;
    if (body.phone !== undefined) patch.phone = String(body.phone ?? "").replace(/[^\d]/g, "").slice(0, 15) || null;

    if (body.avatar !== undefined) {
      const avatar = body.avatar === null ? null : String(body.avatar);
      if (avatar !== null) {
        if (!avatar.startsWith("data:image/")) return bad("That does not look like an image.");
        if (avatar.length > MAX_AVATAR_BYTES) {
          return bad("That picture is too large — please choose a smaller one.", "avatar_too_large");
        }
      }
      patch.avatar = avatar;
    }

    if (Object.keys(patch).length === 0) return bad("Nothing to update.");

    for (const [column, value] of Object.entries(patch)) {
      // Column names come from the fixed set above, never from the request.
      await sql`update capx.users set ${sql(column)} = ${value} where id = ${user.id}`;
    }

    const fresh = await currentUser();
    return NextResponse.json({ ok: true, user: fresh }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not save your details");
  }
}
