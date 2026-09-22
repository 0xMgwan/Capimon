import { NextResponse } from "next/server";
import { type PayoutDest } from "@/lib/ntzs";
import { withdrawalQuote, createWithdrawal, lookupRecipient, NtzsError, ntzsConfigured,
         rampQuote, rampOfframp, getSwapRate } from "@/lib/ntzs";
import { currentUser, kycRefusal } from "@/lib/auth";
import { balanceOf, record } from "@/lib/ledger";
import { notify } from "@/lib/notify";
import { requireDb, bad, notConfigured } from "@/lib/apiHelpers";
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
 * Which rail pays this out.
 *
 * Shillings first, whenever the omnibus is holding enough of them.
 *
 * The ramp pays from the USDC float, so using it means sending dollars to the
 * float and having them converted back into shillings at the other end. For
 * someone who sold a shilling-priced share, holds shillings, and is being paid
 * in shillings, that is a round trip through a currency nobody involved asked
 * for — and it is charged a spread on both legs.
 *
 * The ramp used to be preferred unconditionally because the disbursement rail
 * refuses to quote more than the omnibus is holding. That is a real limit, but
 * it is a balance that can be read rather than a reason to avoid the rail
 * entirely. So: disburse when the shillings are already there, and fall back to
 * the ramp when they are not.
 */
async function chooseRail(amountTzs: number, rampAvailable: boolean) {
  if (!rampAvailable) return false;
  try {
    const { omnibusBalances } = await import("@/lib/omnibus");
    const omnibus = await omnibusBalances();
    // A small margin, so a payout is not routed to a balance that a concurrent
    // trade is about to spend.
    if (omnibus.tzs >= amountTzs * 1.02) return false;
  } catch {
    /* cannot read the omnibus: the ramp can always fund itself */
  }
  return true;
}

/**
 * Cash out to mobile money.
 *
 * Two steps, because the fee is priced upstream and must never be recomputed
 * here: GET returns a quote plus the registered name behind the number so the
 * user can see who is being paid, POST executes against that quote.
 */

/** Price a withdrawal and confirm the destination. */
/**
 * The payout destination from a request: a bank when a bank code is given,
 * otherwise the phone number. Returns an error message instead when neither
 * is usable.
 */
function readDest(get: (k: string) => string | null, fallbackPhone: string | null | undefined):
  { dest: PayoutDest; label: string } | { error: string } {
  const bankCode = (get("bankCode") ?? "").trim().toUpperCase();
  if (bankCode) {
    const accountNumber = (get("accountNumber") ?? "").replace(/[^\d]/g, "");
    if (!/^[A-Z0-9_]{2,16}$/.test(bankCode)) return { error: "Choose a bank." };
    if (accountNumber.length < 6) return { error: "Enter the bank account number to pay into." };
    return { dest: { bankCode, accountNumber }, label: `${bankCode} account ending ${accountNumber.slice(-4)}` };
  }
  const phoneNumber = (get("phoneNumber") ?? fallbackPhone ?? "").replace(/[^\d]/g, "");
  if (!phoneNumber) return { error: "A mobile money number is required." };
  return { dest: { phoneNumber }, label: phoneNumber };
}

export async function GET(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (!ntzsConfigured) return notConfigured("nTZS");

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
    /* Priced and paid only for a verified account: this is money leaving. */
    const refusal = kycRefusal(user, "withdraw");
    if (refusal) return NextResponse.json({ ok: false, ...refusal }, { status: 403 });

    const u = new URL(req.url);
    const amountTzs = Math.round(Number(u.searchParams.get("amountTzs")));
    const parsed = readDest((k) => u.searchParams.get(k), user.phone);
    if ("error" in parsed) return bad(parsed.error);
    const { dest } = parsed;
    const phoneNumber = dest.phoneNumber ?? "";
    if (!Number.isFinite(amountTzs) || amountTzs < MIN_TZS) {
      return bad(`The minimum withdrawal is ${MIN_TZS.toLocaleString()} TZS.`);
    }

    const funds = await spendableTzs(user.id);
    if (amountTzs > funds.totalTzs) {
      return bad(`Your balance is ${Math.floor(funds.totalTzs).toLocaleString()} TZS.`, "insufficient_balance");
    }

    const caps = await capabilities();
    // Ramp pays phones only, so a bank payout always takes the disbursement rail.
    const viaRamp = dest.bankCode ? false : await chooseRail(amountTzs, caps.ramp.available);

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
      const q = await withdrawalQuote({ userId: await omnibusUserId(), amountTzs, ...dest });
      quoteId = q.quoteId ?? null;
      // The documented quote carries fees.totalFeeTzs; older responses a flat field.
      feeTzs = Number(q.fees?.totalFeeTzs ?? q.totalFeeTzs ?? 0);
      quotedName = q.recipientName ?? null;
      if (!quoteId) quoteShape = Object.keys(q ?? {}).join(", ").slice(0, 200);
    }

    const recipient = phoneNumber
      ? await lookupRecipient(phoneNumber).catch(() => ({ name: null }))
      : { name: null };
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
      phoneNumber, destination: parsed.label,
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

    const refusal = kycRefusal(user, "withdraw");
    if (refusal) return NextResponse.json({ ok: false, ...refusal }, { status: 403 });

    const body = await req.json();
    const quoteId = String(body.quoteId ?? "");
    const amountTzs = Math.round(Number(body.amountTzs));
    if (!quoteId) return bad("A quote is required — price the withdrawal first.", "quote_required");
    const parsed = readDest((k) => (body[k] == null ? null : String(body[k])), null);
    if ("error" in parsed) return bad(parsed.error);
    const { dest, label } = parsed;
    const phoneNumber = dest.phoneNumber ?? "";

    // Re-check against the ledger: the quote may be seconds old.
    const funds = await spendableTzs(user.id);
    if (amountTzs > funds.totalTzs) {
      return bad(`Your balance is ${Math.floor(funds.totalTzs).toLocaleString()} TZS.`, "insufficient_balance");
    }

    // Same rail choice as the quote, for the same reasons.
    const caps = await capabilities();
    const viaRamp = dest.bankCode ? false : await chooseRail(amountTzs, caps.ramp.available);

    /*
     * Debit before paying out, and refund if the payout does not happen.
     *
     * Paying first and recording after leaves one ordering where money reaches
     * the customer and the ledger never learns of it — which is exactly what
     * happened: an off-ramp settled, the bookkeeping after it threw, and the
     * balance went on claiming funds that had already left. A debit that gets
     * reversed is recoverable; money out with no debit is not.
     *
     * Keyed to the quote, which exists before the payout does, so a retry after
     * an uncertain response cannot debit twice.
     */
    const fromTzs = Math.min(funds.tzs, amountTzs);
    const remainderTzs = amountTzs - fromTzs;
    const fromUsdc = remainderTzs > 0 && funds.usdcPerTzs ? remainderTzs * funds.usdcPerTzs : 0;
    const rail = viaRamp ? "ramp" : "disbursement";

    await record([
      ...(fromTzs > 0
        ? [{ userId: user.id, kind: "withdrawal" as const, asset: "TZS", amount: (-fromTzs).toString(),
             ref: `withdrawal:${quoteId}`, metadata: { destination: label, ...dest, quoteId, rail } }]
        : []),
      ...(fromUsdc > 0
        ? [{ userId: user.id, kind: "withdrawal" as const, asset: "USDC", amount: (-fromUsdc).toString(),
             ref: `withdrawal:${quoteId}:usdc`, metadata: { destination: label, ...dest, quoteId, amountTzs: remainderTzs } }]
        : []),
    ]);

    let result: { id?: string; status?: string };
    try {
      /*
       * Fund first, quote second, spend immediately.
       *
       * A ramp quote is locked for about a minute. Funding the float is a chain
       * transfer that takes seconds to tens of seconds, and it used to run
       * between the quote being priced and the payout being requested — so the
       * quote the customer had read was routinely dead by the time it was
       * spent, and the payout came back "expired, already used, or not an
       * off-ramp quote". The quote shown in the panel is indicative; the one
       * that actually pays is fetched here, moments before it is used.
       *
       * The customer's original quote id still keys the ledger entries, so a
       * retry after an uncertain response cannot debit the same person twice.
       */
      if (viaRamp) {
        const { fundRampFloat } = await import("@/lib/ntzsFunding");
        await fundRampFloat(amountTzs, phoneNumber);

        const fresh = await rampQuote({ direction: "offramp", amount: amountTzs, phoneNumber });
        const freshId = String(fresh.quoteId ?? fresh.id ?? fresh.quote_id ?? fresh.reference ?? "");
        if (!freshId) throw new NtzsError("quote_unavailable", "Could not price the payout just before sending it.", 502);

        result = await rampOfframp({ quoteId: freshId, phoneNumber });
      } else {
        const { ensureNtzsHasTzs } = await import("@/lib/ntzsFunding");
        await ensureNtzsHasTzs(amountTzs);

        const omnibus = await omnibusUserId();
        const fresh = await withdrawalQuote({ userId: omnibus, amountTzs, ...dest });
        const freshId = fresh.quoteId ?? quoteId;

        result = await createWithdrawal({
          userId: omnibus, quoteId: freshId, amountTzs, ...dest,
        });
      }
    } catch (payoutError) {
      /*
       * Refund only when the payout certainly did not happen. An uncertain
       * outcome — a timeout, a 5xx — may still have moved money, so the debit
       * stands and the row is left for reconciliation rather than handing back
       * funds that already left.
       */
      const err = payoutError instanceof NtzsError ? payoutError : null;
      const uncertain = err?.retry === "verify";
      if (!uncertain) {
        await record([
          ...(fromTzs > 0
            ? [{ userId: user.id, kind: "adjustment" as const, asset: "TZS", amount: fromTzs.toString(),
                 ref: `withdrawal:${quoteId}:refund`, metadata: { quoteId, reason: "payout did not execute" } }]
            : []),
          ...(fromUsdc > 0
            ? [{ userId: user.id, kind: "adjustment" as const, asset: "USDC", amount: fromUsdc.toString(),
                 ref: `withdrawal:${quoteId}:refund-usdc`, metadata: { quoteId, reason: "payout did not execute" } }]
            : []),
        ]).catch(() => null);
      }
      throw payoutError;
    }
    const ref = String(result.id ?? quoteId);

    await notify({
      userId: user.id, kind: "withdrawal", ref: `withdrawal:${ref}`,
      title: `${amountTzs.toLocaleString()} TZS sent`,
      body: `On its way to ${label}.`,
    });
    return NextResponse.json({
      ok: true, withdrawalId: ref, amountTzs, status: result.status ?? "submitted",
      note: dest.bankCode ? `On its way to your ${label}.` : "On its way to your mobile money account.",
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
    /*
     * A payout that fails needs to say why. boom() alone gives the customer a
     * reference and puts the reason in a log nobody reading this screen can
     * open, which turned a one-line diagnosis into a round trip. Keep the
     * reference for correlation, but carry the reason with it.
     */
    const raw = e instanceof Error ? e.message : String(e);
    const reason = raw
      .split(/\n\s*\n/)[0]
      .replace(/0x[0-9a-fA-F]{40,}/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    console.error("[capx:withdraw]", raw);
    return NextResponse.json(
      { ok: false, code: "withdrawal_failed", error: `Could not send that withdrawal. ${reason}` },
      { status: 502 },
    );
  }
}
