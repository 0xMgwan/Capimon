import { NextResponse } from "next/server";
import { createDeposit, NtzsError, ntzsConfigured } from "@/lib/ntzs";
import { currentUser } from "@/lib/auth";
import { db, migrate } from "@/lib/db";
import { omnibusUserId } from "@/lib/omnibus";
import { requireDb, bad, boom, notConfigured } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

const MIN_TZS = 500;

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
    if (!phoneNumber) return bad("A mobile money number is required.");
    if (!Number.isFinite(amountTzs) || amountTzs < MIN_TZS) return bad(`Minimum deposit is ${MIN_TZS} TZS.`);

    await migrate();
    const sql = db();
    const rows = await sql<{ id: string }[]>`
      insert into capx.deposits (user_id, amount_tzs, phone)
      values (${user.id}, ${amountTzs}, ${phoneNumber})
      returning id`;
    const localId = rows[0].id;

    try {
      const deposit = await createDeposit({ userId: await omnibusUserId(), amountTzs, phoneNumber });
      await sql`update capx.deposits set ntzs_deposit_id = ${String(deposit.id)} where id = ${localId}`;
      return NextResponse.json({
        ok: true, depositId: localId, status: deposit.status ?? "submitted",
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
