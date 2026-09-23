import { NextResponse } from "next/server";
import { db, migrate, dbConfigured } from "@/lib/db";
import { roleOf } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/**
 * Serves the document filed with an attestation — the pledge of shares, or
 * the holding statement it rests on.
 *
 * On its own route rather than in the attestation list because it is hundreds
 * of kilobytes and the list is read every few seconds. Both desks reach it:
 * FIMCO files the evidence and CAPX has to read it before approving, and an
 * approval made without opening the document is the whole control failing
 * quietly.
 *
 * Served as an attachment, never inline. A PDF rendered in the page would run
 * in this origin, and this origin is the operations desk.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  if (!roleOf(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  await migrate();
  const [row] = await db()<{ document: string | null; document_name: string | null; security: string }[]>`
    select document, document_name, security from capx.custody_attestations where id = ${id}::uuid`;
  if (!row?.document) return NextResponse.json({ ok: false, error: "No document" }, { status: 404 });

  const match = /^data:([^;]+);base64,(.*)$/s.exec(row.document);
  if (!match) return NextResponse.json({ ok: false, error: "Unreadable document" }, { status: 500 });
  const [, mime, b64] = match;

  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1] ?? "bin";
  const name = row.document_name || `${row.security}-attestation.${ext}`;

  return new NextResponse(Buffer.from(b64, "base64") as unknown as BodyInit, {
    headers: {
      "content-type": mime,
      // Quoted and stripped of quotes of its own: a filename is user input.
      "content-disposition": `attachment; filename="${name.replace(/["\\]/g, "")}"`,
      "cache-control": "no-store",
    },
  });
}
