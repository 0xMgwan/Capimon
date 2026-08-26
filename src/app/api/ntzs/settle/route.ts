import { NextResponse } from "next/server";
import { getDeposit, rampStatus, rampSettlements, ntzsConfigured } from "@/lib/ntzs";
import { db, migrate } from "@/lib/db";
import { record } from "@/lib/ledger";
import { requireDb } from "@/lib/apiHelpers";
import { dbConfigured } from "@/lib/db";

/** postgres.js types json narrowly; upstream payloads are opaque by nature. */
const asJson = (v: unknown) => JSON.parse(JSON.stringify(v ?? {}));

export const dynamic = "force-dynamic";


const TERMINAL_OK = new Set(["settled", "completed", "success", "successful", "filled", "confirmed"]);
const TERMINAL_BAD = new Set(["failed", "cancelled", "canceled", "expired", "rejected"]);

/**
 * Settles pending deposits: confirm the collection landed and credit the
 * depositor. Every route but ramp credits shillings and leaves them in the
 * omnibus to be swapped at buy time; ramp settles straight to USDC and is
 * credited in USDC.
 *
 * Credit happens only on a confirmed collection. Crediting on submission would
 * let an abandoned prompt create a balance out of nothing. Every credit is keyed
 * to the deposit id, so running this twice cannot pay twice.
 *
 * Safe to call from a cron, a webhook, or the user polling their own deposit.
 */
export async function settlePending(): Promise<{ checked: number; results: Record<string, string>[] }> {
  // Settlement only needs the database and nTZS; the treasury is required for
  // the wallet route's transfer leg, not for a ramp credit.
  if (!dbConfigured || !ntzsConfigured) return { checked: 0, results: [] };

  await migrate();
  const sql = db();

  const pending = await sql<{ id: string; user_id: string; ntzs_deposit_id: string;
                             amount_tzs: number; metadata: { route?: string; quotedUsdc?: number } }[]>`
    select id::text, user_id::text, ntzs_deposit_id, amount_tzs, metadata
      from capx.deposits
     where status in ('pending','uncertain') and ntzs_deposit_id is not null
     order by created_at asc
     limit 20`;

  const results: Record<string, string>[] = [];

  for (const d of pending) {
    try {
      const viaRamp = d.metadata?.route === "ramp";

      /*
       * The onramp response does not always carry an id we can look up later —
       * where it did not, the quote id was stored instead, and reading that
       * back fails. Falling back to the settlements list and matching on any
       * identifier we hold recovers those, which matters because the money has
       * already moved by then.
       */
      let remote: Record<string, unknown>;
      if (viaRamp) {
        remote = await rampStatus(d.ntzs_deposit_id).catch(() => ({}) as Record<string, unknown>);
        if (!remote.status) {
          const list = await rampSettlements().catch(() => null);
          const rows = (list?.settlements ?? list?.data ?? []) as Record<string, unknown>[];
          const match = rows.find((r) =>
            [r.id, r.reference, r.quoteId, r.settlementId]
              .some((v) => v && String(v) === d.ntzs_deposit_id)
            // Last resort: the same shilling amount, still unsettled locally.
            || Number(r.tzsAmount ?? r.amountTzs ?? r.tzs ?? 0) === d.amount_tzs);
          if (match) remote = match;
        }
      } else {
        remote = await getDeposit(d.ntzs_deposit_id) as Record<string, unknown>;
      }
      const status = String(remote.status ?? "").toLowerCase();

      // Keep the upstream view on the row either way — a stuck deposit is
      // easier to chase when the last thing nTZS said is recorded.
      const reference = String(remote.reference ?? remote.providerReference ?? remote.id ?? "");
      await sql`update capx.deposits
                   set ntzs_status = ${status}, ntzs_reference = ${reference || null},
                       metadata = metadata || ${sql.json(asJson({ deposit: remote }))}
                 where id = ${d.id}`;

      if (TERMINAL_BAD.has(status)) {
        await sql`update capx.deposits set status = 'failed', error = ${status}, settled_at = now() where id = ${d.id}`;
        results.push({ id: d.id, outcome: "failed" });
        continue;
      }
      if (!TERMINAL_OK.has(status)) {
        results.push({ id: d.id, outcome: `still ${status || "pending"}` });
        continue;
      }

      // Every route except ramp holds the deposit as shillings: the money rests
      // in the omnibus wallet (or partner treasury) and the account is credited
      // in TZS. Nothing is converted here — the swap to USDC happens when the
      // user buys, so the rate they get is the rate at the moment they invest.
      // This is what keeps owed and held both in TZS.
      if (!viaRamp) {
        const route = d.metadata?.route ?? "treasury";
        await record([
          { userId: d.user_id, kind: "deposit", asset: "TZS", amount: d.amount_tzs.toString(),
            ref: `deposit:${d.id}`,
            metadata: { ntzsDepositId: d.ntzs_deposit_id, route } },
        ]);
        await sql`update capx.deposits
                     set status = 'settled', settled_at = now(),
                         metadata = metadata || ${sql.json(asJson({ route }))}
                   where id = ${d.id}`;
        results.push({ id: d.id, outcome: `credited ${d.amount_tzs.toLocaleString()} TZS` });
        continue;
      }

      // Ramp settled straight to USDC, so the account is credited in USDC.
      // Whatever the settlement reports, falling back to what the quote priced —
      // the collection is confirmed at this point, so refusing to credit over an
      // unexpected field name would strand a real payment.
      const usdc = Number(
        remote.usdcAmount ?? remote.usdc ?? remote.amountUsdc ?? remote.outputAmount ?? 0,
      ) || Number(d.metadata?.quotedUsdc ?? 0);
      if (!(usdc > 0)) {
        results.push({ id: d.id, outcome: "settled but no USDC amount could be determined" });
        continue;
      }

      // Keyed to the deposit, so a repeated settle is a no-op.
      await record([
        { userId: d.user_id, kind: "deposit", asset: "USDC", amount: usdc.toString(),
          ref: `deposit:${d.id}`, metadata: { amountTzs: d.amount_tzs, ntzsDepositId: d.ntzs_deposit_id } },
      ]);
      await sql`update capx.deposits
                   set status = 'settled', usdc_credited = ${usdc}, settled_at = now(),
                       rate_tzs_usdc = ${d.amount_tzs > 0 ? usdc / d.amount_tzs : null},
                       metadata = metadata || ${sql.json(asJson({ route: "ramp" }))}
                 where id = ${d.id}`;
      results.push({ id: d.id, outcome: `credited ${usdc.toFixed(2)} USDC` });
    } catch (e) {
      const message = e instanceof Error ? e.message : "settlement failed";
      // Left open on purpose: a failed settlement is a reconciliation task, not
      // a reason to discard a collection that may have succeeded.
      await sql`update capx.deposits set error = ${message} where id = ${d.id}`;
      results.push({ id: d.id, outcome: `error: ${message}` });
    }
  }

  return { checked: pending.length, results };
}

/** Callable by a cron, the admin desk, or a client that just paid. */
export async function POST() {
  const gate = requireDb();
  if (gate) return gate;
  return NextResponse.json({ ok: true, ...(await settlePending()) }, { headers: { "cache-control": "no-store" } });
}

export async function GET() {
  return POST();
}
