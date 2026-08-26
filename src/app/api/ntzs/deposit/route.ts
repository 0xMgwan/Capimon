import { NextResponse } from "next/server";
import { createDeposit, rampQuote, rampOnramp, MIN_TZS_BY_ROUTE, NtzsError, ntzsConfigured,
         type PaymentMethod } from "@/lib/ntzs";
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
    const phoneNumber = String(body.phoneNumber ?? user.phone ?? "").replace(/[^\d]/g, "");
    const amountTzs = Math.round(Number(body.amountTzs));
    const method: PaymentMethod = body.paymentMethod === "bank_transfer" ? "bank_transfer" : "mobile_money";
    if (!phoneNumber) return bad("A mobile money number is required.");
    if (!Number.isFinite(amountTzs) || amountTzs < ABSOLUTE_MIN_TZS) {
      return bad(`The minimum deposit is ${ABSOLUTE_MIN_TZS.toLocaleString()} TZS.`);
    }

    /*
     * Ramp is a mobile-money rail: its quote takes a phone number and nothing
     * else. A bank transfer therefore has to go through /deposits, which this
     * deployment will only accept with a userId — so it needs the `wallets`
     * grant, and saying so beats letting the user fill in a form that cannot
     * succeed.
     */
    const plannedRoute = method === "bank_transfer" ? "treasury" : await collectionRoute();
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
        if (method === "bank_transfer") {
          const caps = await capabilities();
          if (!caps.wallets.available) {
            await sql`update capx.deposits set status = 'failed',
                      error = 'bank transfer needs the wallets capability' where id = ${localId}`;
            return NextResponse.json(
              { ok: false, code: "bank_unavailable",
                error: "Bank transfers are not available yet. They run over the deposits rail, which this nTZS key can only use with the 'wallets' capability. Mobile money works now." },
              { status: 503 },
            );
          }
        }

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

/** The caller's own deposits, newest first. */
export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

  await migrate();
  const deposits = await db()`
    select id::text, ntzs_deposit_id, amount_tzs, status, usdc_credited::text, created_at, settled_at
      from capx.deposits where user_id = ${user.id}
     order by created_at desc limit 25`;
  return NextResponse.json({ ok: true, deposits }, { headers: { "cache-control": "no-store" } });
}
