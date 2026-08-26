import { NextResponse } from "next/server";
import { withdrawalQuote, createWithdrawal, lookupRecipient, NtzsError, ntzsConfigured } from "@/lib/ntzs";
import { currentUser } from "@/lib/auth";
import { balanceOf, record } from "@/lib/ledger";
import { requireDb, bad, boom, notConfigured } from "@/lib/apiHelpers";
import { omnibusUserId, capabilities } from "@/lib/omnibus";

export const dynamic = "force-dynamic";

const MIN_TZS = 5_000;

/**
 * Cash out to mobile money.
 *
 * Two steps, because the fee is priced upstream and must never be recomputed
 * here: GET returns a quote plus the registered name behind the number so the
 * user can see who is being paid, POST executes against that quote.
 */

/** Price a withdrawal and confirm the destination. */
export async function GET(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (!ntzsConfigured) return notConfigured("nTZS");

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const u = new URL(req.url);
    const amountTzs = Math.round(Number(u.searchParams.get("amountTzs")));
    const phoneNumber = (u.searchParams.get("phoneNumber") ?? user.phone ?? "").replace(/[^\d]/g, "");
    if (!phoneNumber) return bad("A mobile money number is required.");
    if (!Number.isFinite(amountTzs) || amountTzs < MIN_TZS) {
      return bad(`The minimum withdrawal is ${MIN_TZS.toLocaleString()} TZS.`);
    }

    const balance = await balanceOf(user.id, "TZS");
    if (amountTzs > balance) {
      return bad(`Your balance is ${Math.floor(balance).toLocaleString()} TZS.`, "insufficient_balance");
    }

    // Payouts leave the CAPX account, so they carry the omnibus user id —
    // which the deployment requires and which needs the `wallets` grant.
    const caps = await capabilities();
    if (!caps.wallets.available) {
      return NextResponse.json(
        { ok: false, code: "withdrawals_unavailable",
          error: "Withdrawals are not available yet. The payout endpoint needs a user id, which requires the 'wallets' capability on the nTZS key." },
        { status: 503 },
      );
    }
    const payoutUser = await omnibusUserId();

    const [quote, recipient] = await Promise.all([
      withdrawalQuote({ userId: payoutUser, amountTzs, phoneNumber }),
      lookupRecipient(phoneNumber),
    ]);

    // A null quoteId upstream means the float cannot cover it — not a user error.
    if (!quote.quoteId) {
      return NextResponse.json(
        { ok: false, code: "quote_unavailable",
          error: "Withdrawals are temporarily unavailable. Try again shortly." },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true, quoteId: quote.quoteId, amountTzs,
      feeTzs: quote.totalFeeTzs ?? 0,
      // Fail-soft: no name available is normal, never a reason to block.
      recipientName: quote.recipientName ?? recipient.name ?? null,
      phoneNumber,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const err = e instanceof NtzsError ? e : null;
    return NextResponse.json(
      { ok: false, code: err?.code ?? "quote_failed", error: err?.message ?? "Could not price that withdrawal" },
      { status: err?.status ?? 502 },
    );
  }
}

/** Execute a quoted withdrawal and debit the ledger. */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (!ntzsConfigured) return notConfigured("nTZS");

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json();
    const quoteId = String(body.quoteId ?? "");
    const amountTzs = Math.round(Number(body.amountTzs));
    const phoneNumber = String(body.phoneNumber ?? "").replace(/[^\d]/g, "");
    if (!quoteId) return bad("A quote is required — price the withdrawal first.", "quote_required");
    if (!phoneNumber) return bad("A mobile money number is required.");

    // Re-check against the ledger: the quote may be seconds old.
    const balance = await balanceOf(user.id, "TZS");
    if (amountTzs > balance) {
      return bad(`Your balance is ${Math.floor(balance).toLocaleString()} TZS.`, "insufficient_balance");
    }

    // Walk the money back to nTZS first if it is sitting in the treasury —
    // the payout is made from the nTZS balance, not from the chain.
    const { ensureNtzsHasTzs } = await import("@/lib/ntzsFunding");
    await ensureNtzsHasTzs(amountTzs);

    const result = await createWithdrawal({
      userId: await omnibusUserId(), quoteId, amountTzs, phoneNumber,
    });
    const ref = String(result.id ?? quoteId);

    // Debited once the payout is accepted, keyed to the payout so a retry after
    // an uncertain response cannot debit twice.
    await record([
      { userId: user.id, kind: "withdrawal", asset: "TZS", amount: (-amountTzs).toString(),
        ref: `withdrawal:${ref}`, metadata: { phoneNumber, quoteId } },
    ]);

    return NextResponse.json({
      ok: true, withdrawalId: ref, amountTzs, status: result.status ?? "submitted",
      note: "On its way to your mobile money account.",
    });
  } catch (e) {
    const err = e instanceof NtzsError ? e : null;
    if (err?.code === "quote_stale") {
      return NextResponse.json(
        { ok: false, code: "quote_stale", error: "That quote expired. Price it again." },
        { status: 409 },
      );
    }
    if (err) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, retry: err.retry,
          note: err.retry === "verify" ? "The outcome is uncertain — check your balance before retrying." : undefined },
        { status: err.status },
      );
    }
    return boom(e, "Could not send that withdrawal.");
  }
}
