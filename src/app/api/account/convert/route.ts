import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { currentUser } from "@/lib/auth";
import { balanceOf, record } from "@/lib/ledger";
import { requireDb, bad, boom } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/**
 * Turns a dollar balance back into shillings.
 *
 * This exists because of a one-way door. A shilling buy converts to USDC and
 * then trades; when the trade fails, the customer's money is correctly
 * recorded as USDC — and until now that was where it stayed. They could buy a
 * US share with it or withdraw it, but they could not put it back in the
 * currency they hold everything else in. For somebody whose balance is
 * shillings and whose intention was CRDB, a failed order left them holding a
 * currency they never asked for.
 *
 * The ledger is written only after the swap reports what it produced, and the
 * figure credited is that report rather than a balance reading — the omnibus
 * is shared, and differencing it credits one customer for another's movement.
 *
 * One direction only. Shillings become dollars when somebody buys a US share,
 * which is the moment that conversion is for; a button that did it at any
 * other time would be a currency desk, and CAPX is not one.
 */
const MIN_USDC = 0.01;

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const held = await balanceOf(user.id, "USDC");

    /*
     * "All of it" is the case this is really for, and asking somebody to type
     * 0.82 to clear a balance of 0.82 invites them to leave dust behind by
     * mistyping it.
     */
    const amount = body.all === true ? held : Number(body.amountUsdc);
    if (!Number.isFinite(amount) || amount < MIN_USDC) {
      return bad(`The smallest amount to convert is $${MIN_USDC.toFixed(2)}.`);
    }
    if (amount > held + 1e-9) {
      return bad(`You hold $${held.toFixed(2)}.`, "insufficient_balance");
    }

    // Rounded to the ledger's own precision, so the debit cannot exceed what
    // the swap was asked for.
    const usdc = Math.floor(amount * 1e6) / 1e6;

    const { swapUsdcToTzs } = await import("@/lib/ntzsFunding");
    const converted = await swapUsdcToTzs(usdc);

    /*
     * Both legs or neither, keyed to one reference.
     *
     * `record` is transactional, so a debit cannot land without its credit —
     * which in a currency conversion is the only property that matters.
     */
    const ref = `convert:${randomUUID()}`;
    await record([
      { userId: user.id, kind: "adjustment", asset: "USDC", amount: (-converted.usdcSpent).toString(),
        ref: `${ref}:usdc`,
        metadata: { reason: "converted to shillings", tzs: converted.tzs } },
      { userId: user.id, kind: "adjustment", asset: "TZS", amount: converted.tzs.toString(),
        ref: `${ref}:tzs`,
        metadata: { reason: "converted from dollars", usdc: converted.usdcSpent } },
    ]);

    return NextResponse.json({
      ok: true,
      usdc: converted.usdcSpent,
      tzs: converted.tzs,
    });
  } catch (e) {
    if (e instanceof Error && e.message && e.message.length < 300) {
      return bad(e.message, "convert_failed");
    }
    return boom(e, "Could not convert your balance");
  }
}
