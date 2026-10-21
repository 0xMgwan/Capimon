import { NextResponse } from "next/server";
import { ntzsConfigured } from "@/lib/ntzs";
import { startDeposit } from "@/lib/deposits";
import { currentUser } from "@/lib/auth";
import { db, migrate } from "@/lib/db";
import { requireDb, bad, boom, notConfigured } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/**
 * The HTTP side of starting a deposit.
 *
 * Choosing the rail, writing the row before the money is asked for and
 * deciding what an uncertain initiation means all live in lib/deposits.ts, so
 * that a partner funding their own customer runs the identical path rather
 * than a copy of it. What is left here is reading the request and handing
 * back the answer.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (!ntzsConfigured) return notConfigured("nTZS");

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json();

    /*
     * Putting away the bank instructions.
     *
     * The panel has to survive a reload — somebody copying an account number
     * into a banking app will leave the page and come back — so it is drawn
     * from the deposit row rather than from component state, and it stays for
     * the reference's full 72 hours. The consequence was that saying "I have
     * sent it", or simply deciding not to, cleared it until the next refresh
     * and no further.
     *
     * Dismissing is a display choice, not a financial one: the row keeps its
     * status and settlement keeps watching it, so a transfer that arrives on
     * day three is still credited to somebody who put the panel away on day
     * one.
     */
    if (body.action === "dismiss") {
      const reference = String(body.reference ?? "").trim();
      if (!reference) return bad("Which transfer?");
      await migrate();
      await db()`
        update capx.deposits
           set metadata = metadata || '{"dismissed": true}'::jsonb
         where user_id = ${user.id} and metadata->'bank'->>'reference' = ${reference}`;
      return NextResponse.json({ ok: true });
    }

    const result = await startDeposit({
      userId: user.id,
      amountTzs: Number(body.amountTzs),
      phoneNumber: String(body.phoneNumber ?? user.phone ?? ""),
      method: body.paymentMethod === "bank_transfer" ? "bank_transfer" : "mobile_money",
      payerAccountNumber: body.payerAccountNumber ? String(body.payerAccountNumber) : undefined,
    });

    if (!result.ok) {
      const { status, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json(result);
  } catch (e) {
    return boom(e, "Could not start the deposit.");
  }
}

/** The caller's own deposits, newest first. */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

  await migrate();
  const deposits = await db()`
    select id::text, ntzs_deposit_id, amount_tzs, status, usdc_credited::text, created_at, settled_at,
           ntzs_status, error,
           -- Which way they chose to pay, so the page can word itself for it.
           metadata->>'paymentMethod' as payment_method,
           /*
            * Open bank transfers carry their payment details, so a customer
            * who closed the page can see where to send the money again.
            *
            * 'expired' counts here. A row stops being shown as in flight after
            * five minutes, but the reference it points at is good for 72 hours
            * — dropping the details at five would take away the account number
            * of a transfer somebody is still perfectly able to make. What ends
            * this is the reference's own expiry, which is what it says on the
            * panel.
            */
           case when metadata ? 'bank' and status in ('pending','uncertain','expired')
                     and not (metadata ? 'dismissed')
                     and (metadata->'bank'->>'expiresAt')::timestamptz > now()
                then metadata->'bank' end as bank
      from capx.deposits where user_id = ${user.id}
     order by created_at desc limit 25`;
  return NextResponse.json({ ok: true, deposits }, { headers: { "cache-control": "no-store" } });
}
