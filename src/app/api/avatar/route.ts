import { NextResponse } from "next/server";
import { db, dbConfigured, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * A customer's picture, served as an image rather than embedded as text.
 *
 * Avatars are stored as data URLs, which is fine for the one belonging to the
 * signed-in account and wrong for anybody else's: a notification list that
 * carried thirty base64 photographs inside its JSON would be hundreds of
 * kilobytes of text to show thirty small circles. Here the row carries a
 * handle, the browser fetches the picture once, and every later mention from
 * the same person is a cache hit.
 *
 * A handle is already public — it is what appears on a comment — so this
 * reveals nothing the page does not. It carries no name, no trading and no
 * account details, only the picture.
 */
export async function GET(req: Request) {
  const username = new URL(req.url).searchParams.get("u")?.trim().toLowerCase().replace(/^@/, "");
  if (!username || !dbConfigured) return new NextResponse(null, { status: 404 });

  try {
    await migrate();
    const [row] = await db()<{ avatar: string | null }[]>`
      select avatar from capx.users where lower(username) = ${username}`;

    // No picture is not an error: the caller draws initials instead, and a
    // 404 is what tells it to.
    const m = row?.avatar?.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
    if (!m) return new NextResponse(null, { status: 404 });

    return new NextResponse(Buffer.from(m[2], "base64"), {
      headers: {
        "content-type": m[1],
        // Long, because a photograph that changes is a rare event and a stale
        // one for an hour costs nothing. Public: there is nothing private in
        // an image already shown beside a public handle.
        "cache-control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
