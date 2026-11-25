import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { kycImage } from "@/lib/kyc";
import { roleOf, grantKeyFor } from "@/lib/adminAuth";
import { checkGrant } from "@/lib/imageGrant";

export const dynamic = "force-dynamic";

/**
 * Serves one identity image to a reviewer.
 *
 * An <img> tag carries no headers, so this used to be opened with a desk
 * token in the query string — a credential that opens everything, written
 * into browser history, referrers and every log in between, next to a URL
 * pointing at somebody's identity document.
 *
 * It now takes a grant instead: minted by the listing that already
 * authenticated the reviewer, good for this one document for ten minutes,
 * and worth nothing anywhere else. A bearer header still works for anything
 * that can send one.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return new NextResponse("not configured", { status: 503 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const which = url.searchParams.get("which") === "selfie" ? "selfie" : "doc";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("bad id", { status: 400 });

  /* The id is validated before the grant is checked, because the grant is
     checked *against* it — an unchecked id would be compared to itself. */
  const grant = url.searchParams.get("g") ?? "";
  const permitted = roleOf(req)
    || (grant && checkGrant(grant, { id, which }, grantKeyFor).ok);
  if (!permitted) return new NextResponse("unauthorised", { status: 401 });

  const row = await kycImage(id, which).catch(() => null);
  if (!row) return new NextResponse("not found", { status: 404 });

  return new NextResponse(new Uint8Array(row.image), {
    headers: {
      "content-type": row.mime,
      "content-length": String(row.image.length),
      "cache-control": "private, no-store",
      /*
       * An identity document should never be framed by another origin.
       *
       * `frame-ancestors` is the directive that does that. It allows 'self'
       * rather than 'none' because the custody portal embeds a scanned PDF ID
       * inline, and 'none' blocked even our own page from showing it. Every
       * other origin is still refused.
       */
      "content-security-policy": "frame-ancestors 'self'",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename="${which}-${id.slice(0, 8)}${
        row.mime === "application/pdf" ? ".pdf" : ".jpg"}"`,
    },
  });
}
