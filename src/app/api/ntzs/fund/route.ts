import { NextResponse } from "next/server";
import { getUser, swap, transferUsdc, NtzsError, ntzsConfigured } from "@/lib/ntzs";
import { currentUser } from "@/lib/auth";
import { record } from "@/lib/ledger";
import { treasuryAddress, treasuryConfigured } from "@/lib/treasury";
import { requireDb, bad, notConfigured } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/**
 * Moves a user's shillings into their CAPX trading balance:
 * swap nTZS to USDC inside their nTZS account, send that USDC to the CAPX
 * treasury, then credit their ledger.
 *
 * From here CAPX holds the funds. The credit is keyed to the transfer id, so
 * a retry after an uncertain response cannot credit the same money twice.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (!ntzsConfigured) return notConfigured("nTZS");
  if (!treasuryConfigured) return notConfigured("The CAPX treasury");

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
    if (!user.ntzsUserId) return bad("Your nTZS account is not set up yet.", "ntzs_not_linked");

    const treasury = treasuryAddress()!;
    const amountTzs = Math.round(Number((await req.json()).amountTzs));
    if (!Number.isFinite(amountTzs) || amountTzs <= 0) return bad("Amount must be greater than zero.");

    const before = await getUser(user.ntzsUserId);
    if ((before.balanceTzs ?? 0) < amountTzs) {
      return bad(`Your nTZS balance is ${(before.balanceTzs ?? 0).toLocaleString()} TZS.`, "insufficient_balance");
    }

    const swapResult = await swap({ userId: user.ntzsUserId, from: "NTZS", to: "USDC", amount: amountTzs });

    // Send what actually landed, read back from chain, not what the quote said.
    const after = await getUser(user.ntzsUserId);
    const usdc = Number(after.balanceUsdc ?? 0);
    if (!(usdc > 0)) {
      return NextResponse.json(
        { ok: false, code: "swap_settled_no_balance",
          error: "The swap completed but no USDC is visible yet. Check again shortly before retrying.",
          swap: swapResult },
        { status: 409 },
      );
    }

    const transfer = await transferUsdc({ fromUserId: user.ntzsUserId, toAddress: treasury, amount: usdc });
    const ref = String(transfer.txHash ?? transfer.id ?? `${user.id}:${Date.now()}`);

    const written = await record([
      { userId: user.id, kind: "deposit", asset: "USDC", amount: usdc.toString(), ref,
        metadata: { amountTzs, source: "ntzs", treasury } },
    ]);

    return NextResponse.json({
      ok: true, swappedTzs: amountTzs, usdcCredited: usdc,
      alreadyCredited: written.duplicate, transfer,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const err = e instanceof NtzsError ? e : null;
    return NextResponse.json(
      { ok: false, code: err?.code ?? "fund_failed", error: err?.message ?? "Could not fund your balance",
        retry: err?.retry,
        note: err?.retry === "verify" ? "The outcome is uncertain — check your balance before retrying." : undefined },
      { status: err?.status ?? 502 },
    );
  }
}
