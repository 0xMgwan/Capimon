import "server-only";
import { createDeposit, rampQuote, rampOnramp, MIN_TZS_BY_ROUTE, NtzsError,
         type PaymentMethod, type BankInstructions } from "./ntzs";
import { db, migrate } from "./db";
import { omnibusUserId, collectionRoute, capabilities } from "./omnibus";

/**
 * Money arriving, wherever the instruction came from.
 *
 * This used to live inside the customer-facing route, which was fine while a
 * signed-in person was the only thing that could start a collection. A partner
 * funding their own customer is the same act performed by a different caller,
 * and the one thing that must not be reimplemented for them is this: the row
 * written before the money is asked for, the route chosen from what nTZS has
 * actually granted, and the rule that an uncertain initiation is left open
 * rather than marked failed.
 *
 * Two copies of that would eventually disagree, and the way they would
 * disagree is by losing somebody's deposit.
 */

export const ABSOLUTE_MIN_TZS = 500;

/** How long nTZS keeps a bank reference open. */
const BANK_REFERENCE_MS = 72 * 3600_000;

export type DepositStarted = {
  ok: true;
  depositId: string;
  route: string;
  status: string;
  note?: string;
  bank?: {
    institution: string | null; accountNumber: string; accountName: string | null;
    reference: string; amountTzs: number; note: string | null; expiresAt: string;
  };
};

export type DepositRefused = {
  ok: false;
  code: string;
  error: string;
  status: number;
  depositId?: string;
  note?: string;
};

export type DepositResult = DepositStarted | DepositRefused;

const refuse = (code: string, error: string, status = 400,
                extra: Partial<DepositRefused> = {}): DepositRefused =>
  ({ ok: false, code, error, status, ...extra });

/**
 * Starts a collection into the CAPX omnibus on one customer's behalf.
 *
 * The local row is written before the money is asked for. With one shared
 * wallet upstream, this table is the only record of whose deposit it was — if
 * the row were written after a successful call, a crash in between would leave
 * money in the omnibus with no owner.
 */
export async function startDeposit(input: {
  userId: string;
  amountTzs: number;
  phoneNumber?: string;
  method?: PaymentMethod;
  payerAccountNumber?: string;
}): Promise<DepositResult> {
  const amountTzs = Math.round(Number(input.amountTzs));
  const method: PaymentMethod = input.method === "bank_transfer" ? "bank_transfer" : "mobile_money";
  const phoneNumber = String(input.phoneNumber ?? "").replace(/[^\d]/g, "");

  if (!Number.isFinite(amountTzs) || amountTzs < ABSOLUTE_MIN_TZS) {
    return refuse("below_minimum",
      `The minimum deposit is ${ABSOLUTE_MIN_TZS.toLocaleString()} TZS.`);
  }

  if (method === "bank_transfer") {
    const payer = String(input.payerAccountNumber ?? "").replace(/[^\d]/g, "");
    if (payer.length < 6) {
      return refuse("payer_account_required",
        "Enter the bank account number you are sending from. That is how the transfer is matched to you.");
    }
    return bankDeposit(input.userId, amountTzs, payer);
  }

  if (!phoneNumber) return refuse("phone_required", "A mobile money number is required.");

  /*
   * Ramp is a mobile-money rail: its quote takes a phone number and nothing
   * else, so every route below is for mobile money. Bank transfers returned
   * above.
   */
  const plannedRoute = await collectionRoute();
  const routeMin = MIN_TZS_BY_ROUTE[plannedRoute] ?? ABSOLUTE_MIN_TZS;
  if (amountTzs < routeMin) {
    return refuse("below_minimum", `The minimum deposit is ${routeMin.toLocaleString()} TZS.`);
  }

  await migrate();
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into capx.deposits (user_id, amount_tzs, phone, metadata)
    values (${input.userId}, ${amountTzs}, ${phoneNumber}, ${sql.json({ paymentMethod: method })})
    returning id`;
  const localId = rows[0].id;

  try {
    // Which route is open depends on what this partner key was granted, so
    // ask rather than assume: `wallets` is off by default, and ramp collects
    // mobile money straight to USDC with no wallets at all.
    const route = plannedRoute;

    if (route === "none") {
      await sql`update capx.deposits set status = 'failed',
                error = 'no collection capability' where id = ${localId}`;
      return refuse("capability_missing",
        "Deposits are not enabled for this deployment yet. The nTZS key needs the 'collections' "
        + "capability. Request it in the nTZS developer dashboard.", 503, { depositId: localId });
    }

    if (route === "treasury") {
      /*
       * The published spec makes userId optional and documents omitting it as
       * the way to collect into the partner treasury. The deployed API
       * disagrees and rejects the call as "userId and amountTzs are required",
       * so try the documented shape and fall back to the omnibus wallet when
       * the deployment insists on a user. The deployment wins over the spec.
       */
      let deposit: { id: string; status: string } | null = null;
      let usedRoute = "treasury";
      try {
        deposit = await createDeposit({ amountTzs, phoneNumber, paymentMethod: method });
      } catch (e) {
        const err = e as NtzsError;
        const wantsUser = /userId/i.test(err?.message ?? "");
        if (!wantsUser) throw e;

        const caps = await capabilities();
        if (!caps.wallets.available) {
          await sql`update capx.deposits set status = 'failed',
                    error = 'treasury collection rejected; wallets not granted' where id = ${localId}`;
          return refuse("treasury_collection_unsupported",
            "nTZS is rejecting treasury collection and this key cannot create a user wallet either. "
            + "Either enable the 'wallets' capability, or have nTZS accept /deposits without a "
            + "userId as its own documentation describes.", 503, { depositId: localId });
        }
        deposit = await createDeposit({ userId: await omnibusUserId(), amountTzs, phoneNumber, paymentMethod: method });
        usedRoute = "omnibus-wallet";
      }

      await sql`update capx.deposits
                   set ntzs_deposit_id = ${String(deposit.id)},
                       metadata = metadata || ${sql.json({ route: usedRoute })}
                 where id = ${localId}`;
      return { ok: true, depositId: localId, route: usedRoute,
        status: deposit.status ?? "submitted",
        note: "Approve the prompt on your phone. Your balance updates once it settles." };
    }

    if (route === "ramp") {
      // Quote first — the rate is locked for 60s and the fee is never ours to
      // recompute — then execute against that quote.
      const quote = await rampQuote({ direction: "onramp", amount: amountTzs, phoneNumber });
      const quoteId = String(quote.quoteId ?? quote.id ?? "");
      if (!quoteId) throw new NtzsError("quote_missing", "The ramp quote returned no id", 502);

      const settlement = await rampOnramp({ quoteId, phoneNumber });
      // The quote already priced this collection. Keeping it means settlement
      // has a figure to credit even if the settlement payload names its
      // amount something we did not anticipate.
      const quotedUsdc = Number(quote.usdcAmount ?? quote.outputAmount ?? quote.amountOut ?? 0) || null;
      await sql`update capx.deposits
                   set ntzs_deposit_id = ${String(settlement.id ?? quoteId)},
                       rate_tzs_usdc = ${quotedUsdc ? quotedUsdc / amountTzs : null},
                       metadata = metadata || ${sql.json(JSON.parse(JSON.stringify({
                         route: "ramp", quotedUsdc, quote, settlement,
                       })))}
                 where id = ${localId}`;
      return { ok: true, depositId: localId, route: "ramp",
        status: settlement.status ?? "submitted",
        note: "Approve the prompt on your phone. Your balance updates once it settles." };
    }

    const deposit = await createDeposit({ userId: await omnibusUserId(), amountTzs, phoneNumber, paymentMethod: method });
    await sql`update capx.deposits
                 set ntzs_deposit_id = ${String(deposit.id)},
                     metadata = metadata || ${sql.json({ route: "omnibus-wallet" })}
               where id = ${localId}`;
    return { ok: true, depositId: localId, route: "omnibus-wallet",
      status: deposit.status ?? "submitted",
      note: "Approve the prompt on your phone. Your balance updates once it settles." };
  } catch (e) {
    const err = e instanceof NtzsError ? e : null;
    // An uncertain initiation may still have taken the money, so the row stays
    // open for reconciliation rather than being marked failed.
    const uncertain = err?.retry === "verify";
    await sql`update capx.deposits set status = ${uncertain ? "uncertain" : "failed"},
              error = ${err?.message ?? "initiation failed"} where id = ${localId}`;
    return refuse(err?.code ?? "deposit_failed", err?.message ?? "Deposit failed",
      err?.status ?? 502, {
        depositId: localId,
        note: uncertain
          ? "The collection may still have been taken. Check your balance before trying again."
          : undefined,
      });
  }
}

/**
 * A bank transfer is a push, not a pull.
 *
 * nTZS issues a one-off reference and the account to pay into; the customer
 * sends exactly that amount from any Tanzanian bank over TIPS with the
 * reference in the description, and nTZS mints once the credit lands. There is
 * no prompt. The docs say the reference alone matches the money, but the
 * deployed API also insists on the sending account, so both are collected.
 *
 * The documented shape takes a userId, so this goes to the omnibus wallet
 * directly rather than trying the treasury first.
 */
async function bankDeposit(
  userId: string, amountTzs: number, payerAccountNumber: string,
): Promise<DepositResult> {
  const caps = await capabilities();
  if (!caps.wallets.available) {
    return refuse("bank_unavailable",
      "Bank transfers are not available yet. They need the omnibus wallet, which this nTZS key "
      + "cannot use without the 'wallets' capability. Mobile money works now.", 503);
  }

  await migrate();
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into capx.deposits (user_id, amount_tzs, phone, metadata)
    values (${userId}, ${amountTzs}, '', ${sql.json({ paymentMethod: "bank_transfer", route: "omnibus-wallet", payerAccountNumber })})
    returning id`;
  const localId = rows[0].id;

  try {
    const deposit = await createDeposit({ userId: await omnibusUserId(), amountTzs, paymentMethod: "bank_transfer", payerAccountNumber });
    const raw = deposit.instructions;
    const instructions: BankInstructions =
      raw && typeof raw === "object" ? raw : { note: typeof raw === "string" ? raw : undefined };
    const reference = String(instructions.reference ?? deposit.reference ?? "") || null;
    if (!reference || !instructions.accountNumber) {
      // Without both there is nothing a customer can safely pay into. Keep the
      // row open against the id in case nTZS still attaches a credit to it.
      await sql`update capx.deposits set ntzs_deposit_id = ${String(deposit.id)}, status = 'failed',
                error = 'bank instructions missing from response',
                metadata = metadata || ${sql.json(JSON.parse(JSON.stringify({ deposit })))}
                where id = ${localId}`;
      return refuse("bank_instructions_missing",
        "nTZS did not return an account to pay into. Nothing has been taken; try mobile money or "
        + "try again shortly.", 502, { depositId: localId });
    }

    const bank = {
      institution: instructions.institution ?? null,
      accountNumber: instructions.accountNumber,
      accountName: instructions.accountName ?? null,
      reference,
      amountTzs: Number(instructions.amountTzs ?? amountTzs),
      note: instructions.note ?? null,
      expiresAt: new Date(Date.now() + BANK_REFERENCE_MS).toISOString(),
    };
    await sql`update capx.deposits
                 set ntzs_deposit_id = ${String(deposit.id)},
                     ntzs_reference = ${reference},
                     metadata = metadata || ${sql.json({ bank })}
               where id = ${localId}`;
    return { ok: true, depositId: localId, route: "bank",
      status: deposit.status ?? "submitted", bank };
  } catch (e) {
    const err = e instanceof NtzsError ? e : null;
    await sql`update capx.deposits set status = ${err?.retry === "verify" ? "uncertain" : "failed"},
              error = ${err?.message ?? "initiation failed"} where id = ${localId}`;
    return refuse(err?.code ?? "deposit_failed",
      err?.message ?? "Could not prepare the bank transfer.", err?.status ?? 502,
      { depositId: localId });
  }
}
