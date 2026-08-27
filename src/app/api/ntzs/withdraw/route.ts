import { NextResponse } from "next/server";
import { withdrawalQuote, createWithdrawal, lookupRecipient, NtzsError, ntzsConfigured,
         rampQuote, rampOfframp, getSwapRate } from "@/lib/ntzs";
import { currentUser } from "@/lib/auth";
import { balanceOf, record } from "@/lib/ledger";
import { requireDb, bad, boom, notConfigured } from "@/lib/apiHelpers";
import { omnibusUserId, capabilities } from "@/lib/omnibus";

export const dynamic = "force-dynamic";

const MIN_TZS = 5_000;

/**
 * What the account can actually withdraw, in shillings.
 *
 * A deposit settles as TZS on the wallet routes and as USDC on the ramp, so an
 * account may hold either. Checking TZS alone told a fully funded ramp customer
 * their balance was zero.
 */
async function spendableTzs(userId: string) {
  const [tzs, usdc] = await Promise.all([
    balanceOf(userId, "TZS"),
    balanceOf(userId, "USDC"),
  ]);
  if (usdc <= 0) return { tzs, usdc, totalTzs: tzs, usdcPerTzs: null as number | null };

  // Value the USDC leg at the live shilling rate; without one, only the TZS
  // balance is offered rather than guessing at a conversion.
  let usdcPerTzs: number | null = null;
  try {
    const r = await getSwapRate("NTZS", "USDC", 100_000);
    const out = Number(r.expectedOutput ?? 0);
    if (out > 0) usdcPerTzs = out / 100_000;
  } catch { /* fall back to shillings only */ }

  const totalTzs = tzs + (usdcPerTzs ? usdc / usdcPerTzs : 0);
  return { tzs, usdc, totalTzs, usdcPerTzs };
}

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

    const funds = await spendableTzs(user.id);
    if (amountTzs > funds.totalTzs) {
      return bad(`Your balance is ${Math.floor(funds.totalTzs).toLocaleString()} TZS.`, "insufficient_balance");
    }

    /*
     * Two payout rails, and the ramp is preferred for both.
     *
     * The ramp debits the USDC settlement float, which the treasury can top up
     * by signing a transfer — so it can pay any amount the customer is owed.
     * The disbursement rail pays from the omnibus wallet's shillings, and that
     * holds only what has not yet been swapped, so it refuses to quote a payout
     * larger than the balance sitting there. Deposits routing through the
     * omnibus is unrelated to which rail can fund a payout, and tying them
     * together declined withdrawals the account could comfortably afford.
     */
    const caps = await capabilities();
    const viaRamp = caps.ramp.available;

    let quoteId: string | null = null;
    let feeTzs = 0;
    let quotedName: string | null = null;

    let quoteShape = "";
    if (viaRamp) {
      const q = await rampQuote({ direction: "offramp", amount: amountTzs, phoneNumber });
      // Accept whichever name the deployment uses, and remember the shape so a
      // miss can be diagnosed from the response instead of guessed at.
      quoteId = String(q.quoteId ?? q.id ?? q.quote_id ?? q.reference ?? "") || null;
      feeTzs = Number(q.totalFeeTzs ?? q.feeTzs ?? q.feeAmountTzs ?? 0);
      if (!quoteId) quoteShape = Object.keys(q ?? {}).join(", ").slice(0, 200);
    } else {
      const q = await withdrawalQuote({ userId: await omnibusUserId(), amountTzs, phoneNumber });
      quoteId = q.quoteId ?? null;
      feeTzs = Number(q.totalFeeTzs ?? 0);
      quotedName = q.recipientName ?? null;
      if (!quoteId) quoteShape = Object.keys(q ?? {}).join(", ").slice(0, 200);
    }

    const recipient = await lookupRecipient(phoneNumber).catch(() => ({ name: null }));
    const quote = { quoteId, totalFeeTzs: feeTzs, recipientName: quotedName };

    /*
     * No quote id came back. That is either a refusal upstream or a field we do
     * not recognise, and those need opposite responses — so name the fields the
     * response actually carried rather than telling the customer to try again
     * at something that will never succeed on its own.
     */
    if (!quote.quoteId) {
      return NextResponse.json(
        { ok: false, code: "quote_unavailable",
          error: quoteShape
            ? `nTZS returned no quote id for this payout. Response fields: ${quoteShape}.`
            : "Withdrawals are temporarily unavailable. Try again shortly." },
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
    const funds = await spendableTzs(user.id);
    if (amountTzs > funds.totalTzs) {
      return bad(`Your balance is ${Math.floor(funds.totalTzs).toLocaleString()} TZS.`, "insufficient_balance");
    }

    // Same rail choice as the quote, for the same reasons.
    const caps = await capabilities();
    const viaRamp = caps.ramp.available;

    let result: { id?: string; status?: string };
    if (viaRamp) {
      // The float pays the shillings, so put the USDC there first. The treasury
      // signs that transfer itself — no user wallet involved — and funding is
      // confirmed before the payout is requested.
      const { fundRampFloat } = await import("@/lib/ntzsFunding");
      await fundRampFloat(amountTzs, phoneNumber);
      result = await rampOfframp({ quoteId, phoneNumber });
    } else {
      const { ensureNtzsHasTzs } = await import("@/lib/ntzsFunding");
      await ensureNtzsHasTzs(amountTzs);
      result = await createWithdrawal({
        userId: await omnibusUserId(), quoteId, amountTzs, phoneNumber,
      });
    }
    const ref = String(result.id ?? quoteId);

    // Debit whichever asset actually funded it: shillings first, then the USDC
    // leg at the same rate the amount was offered at. Debiting TZS an account
    // does not hold would leave a negative balance and a phantom liability.
    const fromTzs = Math.min(funds.tzs, amountTzs);
    const remainderTzs = amountTzs - fromTzs;
    const fromUsdc = remainderTzs > 0 && funds.usdcPerTzs ? remainderTzs * funds.usdcPerTzs : 0;

    // Keyed to the payout, so a retry after an uncertain response cannot debit twice.
    await record([
      ...(fromTzs > 0
        ? [{ userId: user.id, kind: "withdrawal" as const, asset: "TZS", amount: (-fromTzs).toString(),
             ref: `withdrawal:${ref}`, metadata: { phoneNumber, quoteId, rail: viaRamp ? "ramp" : "disbursement" } }]
        : []),
      ...(fromUsdc > 0
        ? [{ userId: user.id, kind: "withdrawal" as const, asset: "USDC", amount: (-fromUsdc).toString(),
             ref: `withdrawal:${ref}:usdc`, metadata: { phoneNumber, quoteId, amountTzs: remainderTzs } }]
        : []),
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
