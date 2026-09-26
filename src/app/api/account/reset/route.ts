import { NextResponse } from "next/server";
import { requestReset, consumeReset } from "@/lib/passwordReset";
import { requireDb, bad, boom } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/**
 * Both halves of a password reset.
 *
 * Asking for one takes an email or a handle; spending one takes the token and
 * the new password. They share a route because they are two steps of one act,
 * and the shape of the body says which.
 *
 * The first half always answers the same way. Whether an account exists is not
 * something a stranger gets to learn from a form, so the reply is identical
 * either way and the difference lives only in the inbox.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const body = await req.json();

    if (body.token) {
      const result = await consumeReset(String(body.token), String(body.password ?? ""));
      if (!result.ok) return bad(result.error);
      return NextResponse.json({ ok: true });
    }

    const identifier = String(body.email ?? body.username ?? "").trim();
    if (!identifier) return bad("Enter the email or username on the account.");

    /*
     * Awaited, so a mail server having a bad day is not reported as success —
     * but the answer does not depend on what it found. A caller learns that
     * we tried, never whether there was anybody to try for.
     */
    await requestReset(identifier);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return boom(e, "Could not start a password reset");
  }
}
