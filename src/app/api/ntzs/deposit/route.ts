import { NextResponse } from "next/server";
import { createDeposit, rampQuote, rampOnramp, MIN_TZS_BY_ROUTE, NtzsError, ntzsConfigured,
         type PaymentMethod, type BankInstructions } from "@/lib/ntzs";
import { currentUser } from "@/lib/auth";
import { db, migrate } from "@/lib/db";
import { omnibusUserId, collectionRoute, capabilities } from "@/lib/omnibus";
import { requireDb, bad, boom, notConfigured } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

const ABSOLUTE_MIN_TZS = 500;

/**
 * Starts a mobile money collection into the CAPX omnibus account.
 *
 * The local row is written before the money is asked for. With one shared
 * wallet upstream, this table is the only record of whose deposit it was — if
 * the row were written after a successful call, a crash in between would leave
 * money in the omnibus with no owner.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (!ntzsConfigured) return notConfigured("nTZS");

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json();

    /*
     * Putting away the bank instructions.
     *
     * The panel has to survive a reload — somebody copying an account number
     * into a banking app will leave the page and come back — so it is drawn
     * from the deposit row rather than from component state, and it stays for
     * the reference's full 72 hours. The consequence was that saying "I have
     * sent it", or simply deciding not to, cleared it until the next refresh
     * and no further.
     *
     * Dismissing is a display choice, not a financial one: the row keeps its
     * status and settlement keeps watching it, so a transfer that arrives on
     * day three is still credited to somebody who put the panel away on day
     * one.
     */
    if (body.action === "dismiss") {
      const reference = String(body.reference ?? "").trim();
      if (!reference) return bad("Which transfer?");
      await migrate();
      await db()`
        update capx.deposits
           set metadata = metadata || '{"dismissed": true}'::jsonb
         where user_id = ${user.id} and metadata->'bank'->>'reference' = ${reference}`;
      return NextResponse.json({ ok: true });
    }

    const phoneNumber = String(body.phoneNumber ?? user.phone ?? "").replace(/[^\d]/g, "");
    const amountTzs = Math.round(Number(body.amountTzs));
    const method: PaymentMethod = body.paymentMethod === "bank_transfer" ? "bank_transfer" : "mobile_money";
    if (method === "mobile_money" && !phoneNumber) return bad("A mobile money number is required.");
    if (!Number.isFinite(amountTzs) || amountTzs < ABSOLUTE_MIN_TZS) {
      return bad(`The minimum deposit is ${ABSOLUTE_MIN_TZS.toLocaleString()} TZS.`);
    }

    if (method === "bank_transfer") {
      if (!Number.isFinite(amountTzs) || amountTzs < ABSOLUTE_MIN_TZS) {
        return bad(`The minimum deposit is ${ABSOLUTE_MIN_TZS.toLocaleString()} TZS.`);
      }
      const payerAccountNumber = String(body.payerAccountNumber ?? "").replace(/[^\d]/g, "");
      if (payerAccountNumber.length < 6) {
        return bad("Enter the bank account number you are sending from. That is how the transfer is matched to you.",
                   "payer_account_required");
      }
      return bankDeposit(user.id, amountTzs, payerAccountNumber);
    }

    /*
     * Ramp is a mobile-money rail: its quote takes a phone number and nothing
     * else, so every route below is for mobile money. Bank transfers returned
     * above.
     */
    const plannedRoute = await collectionRoute();
    const routeMin = MIN_TZS_BY_ROUTE[plannedRoute] ?? ABSOLUTE_MIN_TZS;
    if (amountTzs < routeMin) {
      return bad(`The minimum deposit is ${routeMin.toLocaleString()} TZS.`, "below_minimum");
    }

    await migrate();
    const sql = db();
    const rows = await sql<{ id: string }[]>`
      insert into capx.deposits (user_id, amount_tzs, phone, metadata)
      values (${user.id}, ${amountTzs}, ${phoneNumber}, ${sql.json({ paymentMethod: method })})
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
        return NextResponse.json(
          { ok: false, code: "capability_missing",
            error: "Deposits are not enabled for this deployment yet. The nTZS key needs the 'collections' capability. Request it in the nTZS developer dashboard." },
          { status: 503 },
        );
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
            return NextResponse.json(
              { ok: false, code: "treasury_collection_unsupported",
                error: "nTZS is rejecting treasury collection and this key cannot create a user wallet either. Either enable the 'wallets' capability, or have nTZS accept /deposits without a userId as its own documentation describes." },
              { status: 503 },
            );
          }
          deposit = await createDeposit({ userId: await omnibusUserId(), amountTzs, phoneNumber, paymentMethod: method });
          usedRoute = "omnibus-wallet";
        }

        await sql`update capx.deposits
                     set ntzs_deposit_id = ${String(deposit.id)},
                         metadata = metadata || ${sql.json({ route: usedRoute })}
                   where id = ${localId}`;
        return NextResponse.json({
          ok: true, depositId: localId, route: usedRoute, status: deposit.status ?? "submitted",
          note: "Approve the prompt on your phone. Your balance updates once it settles.",
        });
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
        return NextResponse.json({
          ok: true, depositId: localId, route: "ramp", status: settlement.status ?? "submitted",
          note: "Approve the prompt on your phone. Your balance updates once it settles.",
        });
      }

      const deposit = await createDeposit({ userId: await omnibusUserId(), amountTzs, phoneNumber, paymentMethod: method });
      await sql`update capx.deposits
                   set ntzs_deposit_id = ${String(deposit.id)},
                       metadata = metadata || ${sql.json({ route: "omnibus-wallet" })}
                 where id = ${localId}`;
      return NextResponse.json({
        ok: true, depositId: localId, route: "omnibus-wallet", status: deposit.status ?? "submitted",
        note: "Approve the prompt on your phone. Your balance updates once it settles.",
      });
    } catch (e) {
      const err = e instanceof NtzsError ? e : null;
      // An uncertain initiation may still have taken the money, so the row stays
      // open for reconciliation rather than being marked failed.
      const uncertain = err?.retry === "verify";
      await sql`update capx.deposits set status = ${uncertain ? "uncertain" : "failed"},
                error = ${err?.message ?? "initiation failed"} where id = ${localId}`;
      return NextResponse.json(
        { ok: false, code: err?.code ?? "deposit_failed", error: err?.message ?? "Deposit failed",
          depositId: localId,
          note: uncertain ? "The collection may still have been taken. Check your balance before trying again." : undefined },
        { status: err?.status ?? 502 },
      );
    }
  } catch (e) {
    return boom(e, "Could not start the deposit.");
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
async function bankDeposit(userId: string, amountTzs: number, payerAccountNumber: string) {
  const caps = await capabilities();
  if (!caps.wallets.available) {
    return NextResponse.json(
      { ok: false, code: "bank_unavailable",
        error: "Bank transfers are not available yet. They need the omnibus wallet, which this nTZS key cannot use without the 'wallets' capability. Mobile money works now." },
      { status: 503 },
    );
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
      return NextResponse.json(
        { ok: false, code: "bank_instructions_missing",
          error: "nTZS did not return an account to pay into. Nothing has been taken; try mobile money or try again shortly." },
        { status: 502 },
      );
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
    return NextResponse.json({ ok: true, depositId: localId, route: "bank", status: deposit.status ?? "submitted", bank });
  } catch (e) {
    const err = e instanceof NtzsError ? e : null;
    await sql`update capx.deposits set status = ${err?.retry === "verify" ? "uncertain" : "failed"},
              error = ${err?.message ?? "initiation failed"} where id = ${localId}`;
    return NextResponse.json(
      { ok: false, code: err?.code ?? "deposit_failed", error: err?.message ?? "Could not prepare the bank transfer." },
      { status: err?.status ?? 502 },
    );
  }
}

/** How long nTZS keeps a bank reference open. */
const BANK_REFERENCE_MS = 72 * 3600_000;

/** The caller's own deposits, newest first. */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

  await migrate();
  const deposits = await db()`
    select id::text, ntzs_deposit_id, amount_tzs, status, usdc_credited::text, created_at, settled_at,
           ntzs_status, error,
           -- Which way they chose to pay, so the page can word itself for it.
           metadata->>'paymentMethod' as payment_method,
           /*
            * Open bank transfers carry their payment details, so a customer
            * who closed the page can see where to send the money again.
            *
            * 'expired' counts here. A row stops being shown as in flight after
            * five minutes, but the reference it points at is good for 72 hours
            * — dropping the details at five would take away the account number
            * of a transfer somebody is still perfectly able to make. What ends
            * this is the reference's own expiry, which is what it says on the
            * panel.
            */
           case when metadata ? 'bank' and status in ('pending','uncertain','expired')
                     and not (metadata ? 'dismissed')
                     and (metadata->'bank'->>'expiresAt')::timestamptz > now()
                then metadata->'bank' end as bank
      from capx.deposits where user_id = ${user.id}
     order by created_at desc limit 25`;
  return NextResponse.json({ ok: true, deposits }, { headers: { "cache-control": "no-store" } });
}
