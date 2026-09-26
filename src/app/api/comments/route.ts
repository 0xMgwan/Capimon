import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { listComments, postComment, deleteComment } from "@/lib/social";

export const dynamic = "force-dynamic";

/**
 * The conversation on a security's page.
 *
 * Readable by anyone, because a market page is public and a discussion
 * nobody can read is not one. Writing needs an account — not verification:
 * being able to say something is not the same as being able to move money,
 * and a KYC gate on speech would be a strange thing for a broker to impose.
 */
export async function GET(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const symbol = new URL(req.url).searchParams.get("symbol") ?? "";
    if (!symbol) return bad("Which security?");
    const user = await currentUser();
    return NextResponse.json(
      { ok: true, comments: await listComments(symbol, user?.id) },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not load the comments");
  }
}

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    if (body.action === "delete") {
      const done = await deleteComment(user.id, String(body.id ?? ""));
      if (!done) return bad("That comment is not yours to remove.", "not_yours", 403);
      return NextResponse.json({ ok: true });
    }

    // `parentId` makes it a reply; absent, it starts a thread.
    const result = await postComment(
      user.id,
      String(body.symbol ?? ""),
      String(body.body ?? ""),
      body.parentId ? String(body.parentId) : null,
    );
    if ("error" in result) return bad(result.error, "refused", 429);
    return NextResponse.json({ ok: true, comment: result });
  } catch (e) {
    return boom(e, "Could not post your comment");
  }
}
