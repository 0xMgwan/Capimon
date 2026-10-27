import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { linksForUser, revokeLink } from "@/lib/partnerLinks";

export const dynamic = "force-dynamic";

/**
 * The apps a customer has let into their CAPX account.
 *
 * Consent that cannot be reviewed or withdrawn is not really consent. A
 * person who connected NEDApay six months ago should be able to see that they
 * did, and end it without asking NEDApay's permission — so this lives on the
 * customer's own account rather than anywhere a partner controls.
 */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
    return NextResponse.json({ ok: true, partners: await linksForUser(user.id) },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not read your connected apps.");
  }
}

export async function DELETE(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const id = String(body.id ?? "");
    if (!id) return bad("Which connection?");

    /* Scoped to this user, so naming somebody else's link does nothing. */
    const done = await revokeLink(id, "customer", user.id);
    return NextResponse.json({ ok: done });
  } catch (e) {
    return boom(e, "Could not disconnect that app.");
  }
}
