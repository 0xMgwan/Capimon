import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { isLinked } from "@/lib/walletLink";
import { quote, settle, listOrders, available } from "@/lib/otc";

export const dynamic = "force-dynamic";

/**
 * Buying a tokenised share into a wallet, and selling it back.
 *
 * Two gates stand in front of everything here, and both are checked on the
 * server on every call rather than trusted from the page: the account is
 * verified, and the address is one this account has proved it controls. CAPX
 * sending a share to an address it has not checked is the thing this whole
 * feature exists to avoid.
 */
export async function GET(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const symbol = new URL(req.url).searchParams.get("security");
    // The free-inventory figure is public: it is what is left to sell, and a
    // buyer is entitled to know before they start.
    if (symbol) {
      return NextResponse.json(
        { ok: true, security: symbol.toUpperCase(), available: await available(symbol) },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const user = await currentUser();
    if (!user) return bad("Sign in first.", "unauthorised", 401);
    return NextResponse.json(
      { ok: true, orders: await listOrders(user.id) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return boom(e, "Could not read that");
  }
}

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return bad("Sign in first.", "unauthorised", 401);

    const body = await req.json();
    const address = String(body.address ?? "");

    if (!(await isLinked(user.id, address))) {
      return bad("Link this wallet to your account first.", "wallet_unlinked");
    }
    /*
     * Re-checked at the order, not only at the link.
     *
     * Verification can lapse or be withdrawn between linking an address and
     * trading from it, and the question that matters is whether this account
     * is verified now — at the moment a share would actually leave.
     */
    if (user.kycStatus !== "approved") {
      return bad("Your account needs to be verified to trade into a wallet.", "kyc_required");
    }

    if (body.reference && body.txHash) {
      const result = await settle({
        userId: user.id,
        reference: String(body.reference),
        txHash: String(body.txHash),
      });
      if (!result.ok) return bad(result.error, "settle_failed");
      return NextResponse.json({ ok: true, order: result.order });
    }

    const side = body.side === "sell" ? "sell" : "buy";
    const amount = Number(body.amount);
    if (!(amount > 0)) return bad("Enter an amount.");

    return NextResponse.json({
      ok: true,
      quote: await quote({
        userId: user.id, address, security: String(body.security ?? ""), side, amount,
      }),
    });
  } catch (e) {
    /*
     * The refusals in `quote` are written for the customer — not enough
     * inventory, no published price, above the order cap — so they are
     * returned rather than swallowed into a reference number.
     */
    if (e instanceof Error && e.message && e.message.length < 300) {
      return bad(e.message);
    }
    return boom(e, "Could not place that order");
  }
}
