import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { issueNonce, verifyLink, linkedWallets, revokeLink } from "@/lib/walletLink";

export const dynamic = "force-dynamic";

/**
 * Binding an external wallet to a verified CAPX account.
 *
 * Verification is required before an address can be linked, not after. The
 * whole point of the link is that CAPX knows who owns the address it sends a
 * tokenised share to; letting an unverified account bind one first and get
 * checked later would leave a window in which the answer is "we do not know".
 */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return bad("Sign in first.", "unauthorised", 401);
    return NextResponse.json(
      { ok: true, wallets: await linkedWallets(user.id), kycStatus: user.kycStatus },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return boom(e, "Could not read your linked wallets");
  }
}

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return bad("Sign in first.", "unauthorised", 401);
    if (user.kycStatus !== "approved") {
      return bad(
        user.kycStatus === "pending"
          ? "Your verification is still under review. You can link a wallet once it is approved."
          : "Verify your identity before linking a wallet.",
        "kyc_required",
      );
    }

    const body = await req.json();
    const address = String(body.address ?? "");
    if (!address) return bad("Which address?");

    // Step one asks for a challenge; step two returns the signature over it.
    if (!body.signature) {
      return NextResponse.json({ ok: true, ...(await issueNonce(user.id, address)) });
    }

    const result = await verifyLink(user.id, address, String(body.signature));
    if (!result.ok) return bad(result.error);
    return NextResponse.json({ ok: true, wallets: await linkedWallets(user.id) });
  } catch (e) {
    return boom(e, "Could not link that wallet");
  }
}

export async function DELETE(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return bad("Sign in first.", "unauthorised", 401);
    const address = new URL(req.url).searchParams.get("address") ?? "";
    if (!address) return bad("Which address?");
    await revokeLink(user.id, address);
    return NextResponse.json({ ok: true, wallets: await linkedWallets(user.id) });
  } catch (e) {
    return boom(e, "Could not unlink that wallet");
  }
}
