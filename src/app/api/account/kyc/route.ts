import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { decodeImage, kycFor, submitKyc } from "@/lib/kyc";

export const dynamic = "force-dynamic";

const DOC_TYPES = new Set(["nida", "passport", "licence", "voter"]);

/** Where this account's check stands. Never returns the images. */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
    const latest = await kycFor(user.id);
    return NextResponse.json(
      { ok: true, status: latest?.status ?? user.kycStatus ?? "none", reason: latest?.reason ?? null,
        submittedAt: latest?.created_at ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return boom(e, "Could not load your verification status");
  }
}

/**
 * Files an identity check: a document photograph and a selfie taken now.
 *
 * Images arrive as data URLs rather than multipart. The selfie is captured from
 * the camera into a canvas, so it is already in the browser as one, and
 * accepting a single JSON shape means the document and the selfie travel the
 * same path instead of one being a file and the other a string.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const docType = String(body.docType ?? "").toLowerCase();
    if (!DOC_TYPES.has(docType)) return bad("Choose which document you are submitting.");

    let doc, selfie;
    try {
      doc = decodeImage(body.doc, "The document photo");
      selfie = decodeImage(body.selfie, "The selfie");
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Those images could not be read.");
    }

    const id = await submitKyc({
      userId: user.id,
      docType,
      docNumber: body.docNumber ? String(body.docNumber).trim().slice(0, 64) : null,
      doc,
      selfie,
    });

    return NextResponse.json({ ok: true, id, status: "pending" });
  } catch (e) {
    return boom(e, "Could not submit your verification");
  }
}
