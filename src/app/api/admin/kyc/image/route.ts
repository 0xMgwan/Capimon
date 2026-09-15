import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { dbConfigured } from "@/lib/db";
import { kycImage } from "@/lib/kyc";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

/**
 * Serves one identity image to a reviewer.
 *
 * The token comes through the query string because this is loaded by an <img>
 * tag, which cannot carry a header. That puts the token in the browser's
 * history and any proxy log, which is the cost of showing the picture at all —
 * so the response is marked private and no-store, and nothing else about this
 * route is cacheable or guessable without the id.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return new NextResponse("not configured", { status: 503 });

  const url = new URL(req.url);
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
    || url.searchParams.get("token") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  if (!ADMIN_TOKEN || a.length !== b.length || !timingSafeEqual(a, b)) {
    return new NextResponse("unauthorised", { status: 401 });
  }

  const id = url.searchParams.get("id") ?? "";
  const which = url.searchParams.get("which") === "selfie" ? "selfie" : "doc";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("bad id", { status: 400 });

  const row = await kycImage(id, which).catch(() => null);
  if (!row) return new NextResponse("not found", { status: 404 });

  return new NextResponse(new Uint8Array(row.image), {
    headers: {
      "content-type": row.mime,
      "content-length": String(row.image.length),
      "cache-control": "private, no-store",
      // An identity document should never be framed by another origin.
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}
