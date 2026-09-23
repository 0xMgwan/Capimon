import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { roleOf, ACTOR } from "@/lib/adminAuth";
import { contactsFor, setContacts, parseEmails } from "@/lib/opsContacts";

export const dynamic = "force-dynamic";

/**
 * The addresses a counterparty wants our decisions sent to.
 *
 * FIMCO maintains its own: they are the ones who read the mail, and needing
 * CAPX to edit an environment variable every time somebody joins their desk
 * is how a notification list goes stale. CAPX can see them, because CAPX has
 * to be able to answer "where did that go".
 *
 * Only FIMCO's own list exists today, and both roles are scoped to it — this
 * route cannot be used to point CAPX's notices somewhere new.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  if (!roleOf(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  return NextResponse.json(
    { ok: true, emails: await contactsFor("fimco") },
    { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  const role = roleOf(req);
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { emails, rejected } = parseEmails(String(body.emails ?? ""));
  if (rejected.length) {
    return NextResponse.json(
      { ok: false, error: `Not an email address: ${rejected.slice(0, 3).join(", ")}` },
      { status: 400 });
  }

  await setContacts("fimco", emails, ACTOR[role]);
  return NextResponse.json({ ok: true, emails }, { headers: { "cache-control": "no-store" } });
}
