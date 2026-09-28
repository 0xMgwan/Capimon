import { NextResponse } from "next/server";
import { type PayoutDest } from "@/lib/ntzs";
import { withdrawalQuote, createWithdrawal, lookupRecipient, NtzsError, ntzsConfigured,
         rampQuote, rampOfframp, getSwapRate } from "@/lib/ntzs";
import { currentUser, kycRefusal } from "@/lib/auth";
import { balanceOf, record } from "@/lib/ledger";
import { notify } from "@/lib/notify";
import { requireDb, bad, notConfigured } from "@/lib/apiHelpers";
import { omnibusUserId, capabilities } from "@/lib/omnibus";
import { spendableTzs, chooseRail, executePayout } from "@/lib/payout";

export const dynamic = "force-dynamic";

const MIN_TZS = 5_000;

/**
 * Whether CAPX can presently fund this payout, said before it is attempted.
 *
 * A customer's balance is a claim; the float is what can honour it. They part
 * company exactly when enough gain has been realised that the ledger owes
 * more shillings than were ever paid in — that money exists as shares in
 * custody, not as cash, and no amount of asking nTZS will conjure it.
 *
 * Without this the request was accepted and failed downstream, so somebody
 * who had sold at a profit met an upstream error with no explanation and a
 * balance they could not move. Refusing here costs them a message; failing
 * there cost them their confidence.
 *
 * Fails open by design: an unreadable float returns null and the withdrawal
 * proceeds. Blocking a good payout because a balance could not be read would
 * be the worse mistake, and the rails refuse honestly on their own.
 */
async function capacityRefusal(amountTzs: number, userId: string, dest: PayoutDest, label: string) {
  const { payoutCapacityTzs } = await import("@/lib/ntzsFunding");
  const capacity = await payoutCapacityTzs();
  if (capacity === null || amountTzs <= capacity) return null;

  /*
   * The standing bid is not asked here, and asking it here was a mistake.
   *
   * A DSE order writes two ledger entries and moves no money, so a provider
   * buying inventory cannot raise the float by a shilling — this figure would
   * come back identical and the payout would queue anyway. What actually pays
   * a customer is the shillings a provider deposited, and those were counted
   * as capacity long before the bid fired.
   *
   * The bid's job is on the other side of the payout: once money has left, it
   * retires the provider's own cash claim so the float still covers what is
   * owed. That runs in rebalanceClaims, after the money is out.
   *
   * So a float that is genuinely short of cash is genuinely short, and the
   * honest thing is to say so and queue.
   */

  /*
   * Queued rather than refused.
   *
   * The customer did nothing wrong, their balance is real, and telling them
   * to come back later reads as a broken promise. This says the same thing
   * without the refusal: accepted, waiting, and it will be sent. The row is
   * the record that somebody is owed money and that CAPX knows it.
   */
  {
    const { db, migrate } = await import("@/lib/db");
    await migrate();
    const sql = db();

    /*
     * A queued row is not a debit.
     *
     * The balance is only taken when the payout actually goes out, which is
     * right — the customer keeps their money while they wait. It also means
     * the balance check that guarded this request cannot see what is already
     * queued, so the same shillings could be promised twice and the second
     * one would be cancelled by the scheduler after the customer had been
     * told it was accepted. Counting what is already waiting closes that.
     */
    const [waiting] = await sql<{ total: string }[]>`
      select coalesce(sum(amount_tzs), 0)::text as total from capx.withdrawal_queue
       where user_id = ${userId}::uuid and status = 'queued'`;
    const alreadyQueued = Number(waiting?.total ?? 0);
    if (alreadyQueued > 0) {
      const { spendableTzs } = await import("@/lib/payout");
      const funds = await spendableTzs(userId).catch(() => null);
      if (funds && alreadyQueued + amountTzs > funds.totalTzs + 1) {
        return bad(
          `You already have ${Math.round(alreadyQueued).toLocaleString()} TZS queued for payout, `
          + `which is most of your balance. That will be sent shortly — wait for it before asking `
          + `for more.`,
          "already_queued",
          409,
        );
      }
    }

    const queued = await sql<{ id: string }[]>`
      insert into capx.withdrawal_queue (user_id, amount_tzs, destination)
      values (${userId}::uuid, ${amountTzs}, ${sql.json({ ...dest, label } as never)})
      returning id::text`.catch(() => [] as { id: string }[]);

    if (queued.length) {
      const { notify } = await import("@/lib/notify");
      await notify({
        userId, kind: "withdrawal", ref: `queued:${queued[0].id}`,
        title: "Your withdrawal is queued",
        body: `${Math.round(amountTzs).toLocaleString()} TZS to ${label} is on its way. It will be sent shortly.`,
        url: "/activity",
      }).catch(() => {});

      const { sendMail } = await import("@/lib/mail");
      await sendMail({
        subject: "CAPX: a withdrawal is queued for want of shillings",
        text:
          `${Math.round(amountTzs).toLocaleString()} TZS is queued. The float can presently fund ` +
          `${Math.round(capacity).toLocaleString()} TZS and the standing bid could not close the ` +
          `gap.\n\nThe customer's balance is real and is not in question — what is short is ` +
          `shillings, because the value is sitting in inventory rather than in the float. Either ` +
          `fund a provider, or sell inventory on the exchange.`,
      }).catch(() => {});

      return NextResponse.json({
        ok: true, queued: true,
        note: "Your withdrawal is accepted and queued. It will be sent shortly — "
          + "your balance is safe and unchanged in the meantime.",
      });
    }
  }

  /*
   * The desk hears about it immediately. A customer hitting this is the first
   * evidence that realised gains have outrun the float, and it should reach a
   * person before it reaches a second customer.
   */
  void import("@/lib/mail").then((m) => m.sendMail({
    subject: "CAPX: a withdrawal exceeded what the float can pay",
    text:
      `A customer asked to withdraw ${Math.round(amountTzs).toLocaleString()} TZS and the float ` +
      `can presently fund ${Math.round(capacity).toLocaleString()} TZS.\n\n` +
      `Their balance is real and is not in question. What is short is shillings: the redemption ` +
      `panel on the desk shows how much of what is owed is gain that exists as shares rather ` +
      `than cash, and therefore how much inventory needs converting.`,
  })).catch(() => {});

  return bad(
    `Withdrawals are limited to ${Math.floor(capacity).toLocaleString()} TZS at the moment. ` +
    `Your balance is safe and unchanged — take out less now, or try again shortly.`,
    "payout_capacity",
    409,
  );
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
    /*
     * Pricing is not committing, so nothing here spends or promises anything.
     *
     * The capacity check used to run on this leg too, and once it grew the
     * power to call the standing bid and to write a queue row, running it here
     * meant that merely typing an amount into the field could buy a provider's
     * inventory and enrol somebody in a queue they had not agreed to join. The
     * check belongs on the leg where the customer presses the button.
     *
     * What this leg owes them is warning, not silence: if the float is short
     * the quote still prices, and says the payout will be queued.
     */
    const { payoutCapacityTzs } = await import("@/lib/ntzsFunding");
    const capacity = await payoutCapacityTzs();
    const willQueue = capacity !== null && amountTzs > capacity;

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
      willQueue,
      queueNote: willQueue
        ? "The float is short of shillings right now, so this will be accepted and queued rather "
          + "than sent immediately. Your balance stays yours until it goes out."
        : undefined,
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

    // Re-check against the ledger: the quote may be seconds old.
    const funds = await spendableTzs(user.id);
    if (amountTzs > funds.totalTzs) {
      return bad(`Your balance is ${Math.floor(funds.totalTzs).toLocaleString()} TZS.`, "insufficient_balance");
    }
    const noCapacity = await capacityRefusal(amountTzs, user.id, dest, label);
    if (noCapacity) return noCapacity;

    /*
     * The debit, the rail and the refund rule all live in one place, so the
     * scheduler retrying a queued payout cannot drift from what a request
     * does. The quote id is the idempotency key: an uncertain response can
     * be retried without debiting the same person twice.
     */
    const result = await executePayout({
      userId: user.id, amountTzs, dest, label, key: quoteId,
    });
    const ref = result.ref;

    /*
     * Money has left, so the float has fallen while every other balance
     * stands — including the provider's. This is the moment their cash claim
     * should become a share claim, and it is deliberately after the payout:
     * it can never delay or fail a withdrawal that has already succeeded.
     */
    void import("@/lib/liquidity")
      .then((m) => m.rebalanceClaims())
      .catch(() => null);

    await notify({
      userId: user.id, kind: "withdrawal", ref: `withdrawal:${ref}`,
      title: `${amountTzs.toLocaleString()} TZS sent`,
      body: `On its way to ${label}.`,
    });
    return NextResponse.json({
      ok: true, withdrawalId: ref, amountTzs, status: result.status,
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
