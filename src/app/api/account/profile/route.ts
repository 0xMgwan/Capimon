import { NextResponse } from "next/server";
import { db, migrate } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { cleanUsername, usernameProblem, suggestUsername } from "@/lib/usernameRule";

export const dynamic = "force-dynamic";

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
      // Cleaned rather than refused, the same way the sign-up form treats it.
      const username = cleanUsername(body.username);
      if (username) {
        const problem = usernameProblem(username);
        if (problem) return bad(problem);

        const isTaken = async (candidate: string) =>
          (await sql<{ id: string }[]>`
            select id::text from capx.users
             where lower(username) = ${candidate} and id <> ${user.id} limit 1`).length > 0;

        if (await isTaken(username)) {
          const suggestion = await suggestUsername(username, isTaken);
          return NextResponse.json(
            { ok: false, code: "username_taken", suggestion,
              error: suggestion
                ? `That username is taken. ${suggestion} is free.`
                : "That username is already taken." },
            { status: 400 });
        }
      }
      patch.username = username || null;
    }

    if (body.name !== undefined) patch.name = String(body.name ?? "").trim().slice(0, 80) || null;
    if (body.phone !== undefined) patch.phone = String(body.phone ?? "").replace(/[^\d]/g, "").slice(0, 15) || null;

    /*
     * The national ID is editable until it has been verified, and then it is not.
     *
     * Before approval it is something a customer typed and may have fumbled.
     * After approval it is the number a reviewer matched against a document, and
     * letting it change afterwards would leave an approved account whose
     * identity no longer matches the evidence that approved it — which is the
     * failure the whole check exists to prevent.
     */
    if (body.nidaNumber !== undefined) {
      if (user.kycStatus === "approved") {
        return bad(
          "Your ID number is locked to the document we verified. Contact support to change it.",
          "kyc_locked",
        );
      }
      const nida = String(body.nidaNumber ?? "").replace(/[^\d]/g, "").slice(0, 20);
      if (nida && nida.length !== 20) {
        return bad("A NIDA number is 20 digits.");
      }
      patch.nida_number = nida || null;
    }

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
