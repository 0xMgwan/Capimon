import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { viewerOf, ACTOR, grantFor } from "@/lib/adminAuth";
import { customerFile, recordView } from "@/lib/dseOversight";

export const dynamic = "force-dynamic";

/**
 * One shareholder's file, and a line in the log saying it was opened.
 *
 * The record is written before the file is returned rather than after. If the
 * two cannot both happen the order matters: a view that was logged and then
 * failed to render is a harmless extra row, and a view that rendered and
 * failed to log is the row somebody will go looking for and not find.
 *
 * A customer who has never held a DSE security comes back 404 — the same
 * answer as an id that does not exist, so this cannot be used to find out who
 * else banks with CAPX.
 */
export async function GET(req: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  }
  const role = viewerOf(req);
  if (!role) {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }

  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, code: "bad_id", error: "Name the customer by id." },
      { status: 400 });
  }

  await recordView({ actor: ACTOR[role], action: "customer.view", subject: id, req });

  try {
    const file = await customerFile(id);
    if (!file) {
      return NextResponse.json(
        { ok: false, code: "not_found", error: "No shareholder on this book matches that." },
        { status: 404 });
    }
    /* Each filing carries its own two grants, so the portal can show an
       identity document without a DSE token in the image URL. Minted on a
       request that has already proved who is asking. */
    const documents = await Promise.all(file.documents.map(async (d) => ({
      ...d,
      docGrant: await grantFor(req, d.id, "doc"),
      selfieGrant: await grantFor(req, d.id, "selfie"),
    })));
    return NextResponse.json({ ok: true, ...file, documents },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "could not load the file" },
      { status: 500 });
  }
}
