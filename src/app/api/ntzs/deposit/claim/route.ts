import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { claimBankDeposit } from "@/lib/deposits";

export const dynamic = "force-dynamic";

/**
 * "I have sent it — here is the receipt."
 *
 * A bank push is the one deposit route where CAPX cannot see the money coming:
 * nothing is prompted, nothing is pulled, and the reference the customer was
 * told to quote does not survive the rail. nTZS matches the credit off its own
 * statement, which it describes as minutes rather than seconds, and a credit
 * it cannot match waits for a person to look at it.
 *
 * The receipt on the payer's confirmation ends that wait. It is the only thing
 * the customer holds that identifies their payment exactly, and until now
 * there was nowhere to type it.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return bad("Sign in first.", "unauthorised", 401);

    const body = await req.json().catch(() => ({}));
    const depositId = String(body.depositId ?? body.deposit_id ?? "").trim();
    const receipt = String(body.receipt ?? "").trim();
    if (!depositId) return bad("Which deposit is this for?");

    const result = await claimBankDeposit({ userId: user.id, depositId, receipt });
    if (!result.ok) {
      const { status, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not confirm that payment.");
  }
}
