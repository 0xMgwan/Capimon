import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { kycImage } from "@/lib/kyc";
import { viewerOf, ACTOR, grantKeyFor } from "@/lib/adminAuth";
import { checkGrant } from "@/lib/imageGrant";
import { documentOnBook, recordView } from "@/lib/dseOversight";

export const dynamic = "force-dynamic";

/**
 * An identity document, served to the exchange and recorded in the same call.
 *
 * This is the most sensitive thing the portal does, so it is the one route
 * worth reading closely.
 *
 * The token arrives in the query string because an `<img>` tag cannot carry a
 * header. That puts it in browser history and any proxy log, which is the
 * cost of showing the picture at all — so the response is private, no-store,
 * un-framable by any other origin, and the token is the DSE token rather than
 * CAPX's, so what leaks through that door opens a read-only view of one book
 * rather than the operations panel.
 *
 * Scope is checked against the book, not against the request. A submission id
 * belonging to somebody who has never held a Dar es Salaam security is a 404
 * here even though the row exists, because that customer is not this
 * exchange's to look at.
 *
 * And the view is logged before the bytes are read. The customer whose NIDA
 * this is can be told who opened it and when, which is the whole reason the
 * log exists.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return new NextResponse("not configured", { status: 503 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const which = url.searchParams.get("which") === "selfie" ? "selfie" : "doc";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("bad id", { status: 400 });

  /*
   * A grant stands in for the token an <img> cannot send, and carries the
   * role with it.
   *
   * That matters more here than on the KYC route, because the role is not
   * only permission — it is the name written into the access log below. A
   * grant that authorised the read without saying who held it would log the
   * view as nobody, and this log exists so that the customer whose identity
   * document this is can be told who opened it. The grant is signed under
   * that role's own key, so the name in the log is the one that could have
   * produced the signature.
   */
  const grant = url.searchParams.get("g") ?? "";
  const checked = grant ? checkGrant(grant, { id, which }, grantKeyFor) : null;
  const role = viewerOf(req) ?? (checked?.ok ? checked.role : null);
  if (!role) return new NextResponse("unauthorised", { status: 401 });

  const owner = await documentOnBook(id).catch(() => null);
  if (!owner) return new NextResponse("not found", { status: 404 });

  await recordView({
    actor: ACTOR[role], action: "kyc.document", subject: owner.userId,
    detail: { submission: id, which, docType: owner.docType }, req,
  });

  const row = await kycImage(id, which).catch(() => null);
  if (!row) return new NextResponse("not found", { status: 404 });

  return new NextResponse(new Uint8Array(row.image), {
    headers: {
      "content-type": row.mime,
      "content-length": String(row.image.length),
      "cache-control": "private, no-store",
      "content-security-policy": "frame-ancestors 'self'",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename="${which}-${id.slice(0, 8)}${
        row.mime === "application/pdf" ? ".pdf" : ".jpg"}"`,
    },
  });
}
