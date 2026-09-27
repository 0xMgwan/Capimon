import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, boom, notConfigured } from "@/lib/apiHelpers";
import { treasuryConfigured } from "@/lib/treasury";
import { placeUsOrder } from "@/lib/usOrders";

export const dynamic = "force-dynamic";

/**
 * Places a custodial order in a US equity.
 *
 * The work itself lives in `placeUsOrder`, because a standing order has to be
 * able to place exactly the same trade with exactly the same refusals, and a
 * scheduler cannot call an HTTP handler that reads a session cookie. This is
 * the session and the status codes; everything about the money is there.
 */
const STATUS: Record<string, number> = {
  unverified: 403,
  kyc_pending: 403,
  kyc_required: 403,
  trading_paused: 503,
  insufficient_balance: 400,
  bad_request: 400,
  execution_failed: 502,
  not_configured: 503,
};

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (!treasuryConfigured) return notConfigured("Custodial trading");

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json();
    const result = await placeUsOrder(user, {
      symbol: String(body.symbol ?? ""),
      side: body.side === "sell" ? "sell" : "buy",
      amount: Number(body.amount),
      currency: body.currency === "TZS" ? "TZS" : "USDC",
    });

    if (result.ok) return NextResponse.json(result);
    return NextResponse.json(result, { status: STATUS[result.code] ?? 400 });
  } catch (e) {
    return boom(e, "Could not place your order");
  }
}
