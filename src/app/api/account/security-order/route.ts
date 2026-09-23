import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { placeSecurityOrder } from "@/lib/dseOrders";
import { CRDBT_SECURITY } from "@/lib/assets";

export const dynamic = "force-dynamic";

/**
 * An order in a tokenised DSE share: CRDB, NMB, or whatever is registered.
 * `security` defaults to CRDB so clients written before other listings keep
 * working.
 *
 * The rules themselves live in placeSecurityOrder, because a recurring buy
 * has to pass through exactly the same ones. This handler is the part that
 * belongs to HTTP: read the request, hand back the answer.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json();
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) return bad("Amount must be a number.");

    const result = await placeSecurityOrder(user, {
      security: String(body.security ?? CRDBT_SECURITY),
      side: body.side === "sell" ? "sell" : "buy",
      amount,
    });

    if (!result.ok) {
      const { status, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json(result);
  } catch (e) {
    return boom(e, "Could not place your order");
  }
}
