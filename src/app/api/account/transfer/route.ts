import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { transferShares, findRecipient } from "@/lib/transfers";

export const dynamic = "force-dynamic";

/**
 * Sending shares to another CAPX account.
 *
 * The recipient is named by email or handle and has to already exist and be
 * verified. Nothing is held pending somebody signing up: a transfer that
 * waits for a stranger to finish verification is a liability sitting in
 * limbo with no owner, and refusing is the honest answer.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const to = String(body.to ?? "").trim();
    if (!to) return bad("Who are you sending to? Use their email or @handle.");

    const recipient = await findRecipient(to);
    if (!recipient) {
      return bad("No CAPX account matches that email or handle.", "unknown_recipient", 404);
    }

    const result = await transferShares({
      fromUserId: user.id,
      toUserId: recipient.id,
      security: String(body.security ?? ""),
      qty: Number(body.qty),
      note: body.note ? String(body.note) : undefined,
    });

    if (!result.ok) {
      const { status, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json({
      ok: true,
      transfer_id: result.transferId,
      security: result.security,
      qty: result.qty,
      to: { name: recipient.name, email: recipient.email, username: recipient.username },
    });
  } catch (e) {
    return boom(e, "Could not send those shares.");
  }
}
