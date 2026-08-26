import { NextResponse } from "next/server";
import { getDeposit, swap, transferUsdc, ntzsConfigured } from "@/lib/ntzs";
import { db, migrate } from "@/lib/db";
import { record } from "@/lib/ledger";
import { omnibusUserId, omnibusBalances } from "@/lib/omnibus";
import { treasuryAddress, treasuryConfigured } from "@/lib/treasury";
import { requireDb, notConfigured } from "@/lib/apiHelpers";

/** postgres.js types json narrowly; upstream payloads are opaque by nature. */
const asJson = (v: unknown) => JSON.parse(JSON.stringify(v ?? {}));

export const dynamic = "force-dynamic";

const TERMINAL_OK = new Set(["settled", "completed", "success", "successful", "filled", "confirmed"]);
const TERMINAL_BAD = new Set(["failed", "cancelled", "canceled", "expired", "rejected"]);

/**
 * Settles pending deposits: confirm the collection landed, convert it, move the
 * USDC to the treasury, and credit the depositor.
 *
 * Credit happens only on a confirmed collection. Crediting on submission would
 * let an abandoned prompt create a balance out of nothing. Every credit is keyed
 * to the deposit id, so running this twice cannot pay twice.
 *
 * Safe to call from a cron, a webhook, or the user polling their own deposit.
 */
export async function POST() {
  const gate = requireDb();
  if (gate) return gate;
  if (!ntzsConfigured) return notConfigured("nTZS");
  if (!treasuryConfigured) return notConfigured("The CAPX treasury");

  await migrate();
  const sql = db();
  const treasury = treasuryAddress()!;

  const pending = await sql<{ id: string; user_id: string; ntzs_deposit_id: string; amount_tzs: number }[]>`
    select id::text, user_id::text, ntzs_deposit_id, amount_tzs
      from capx.deposits
     where status in ('pending','uncertain') and ntzs_deposit_id is not null
     order by created_at asc
     limit 20`;

  const results: Record<string, string>[] = [];

  for (const d of pending) {
    try {
      const remote = await getDeposit(d.ntzs_deposit_id);
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

      // Convert exactly this deposit, then move what the swap actually produced.
      const before = await omnibusBalances();
      const swapResult = await swap({ userId: await omnibusUserId(), from: "NTZS", to: "USDC", amount: d.amount_tzs });
      const after = await omnibusBalances();
      const usdc = Math.max(0, after.usdc - before.usdc);

      if (!(usdc > 0)) {
        results.push({ id: d.id, outcome: "swapped but no USDC visible yet" });
        continue;
      }

      const transfer = await transferUsdc({ fromUserId: await omnibusUserId(), toAddress: treasury, amount: usdc });

      // Keyed to the deposit, so a repeated settle is a no-op.
      await record([
        { userId: d.user_id, kind: "deposit", asset: "USDC", amount: usdc.toString(),
          ref: `deposit:${d.id}`, metadata: { amountTzs: d.amount_tzs, ntzsDepositId: d.ntzs_deposit_id } },
      ]);
      await sql`update capx.deposits
                   set status = 'settled', usdc_credited = ${usdc}, settled_at = now(),
                       swap_ref = ${String(swapResult.id ?? swapResult.reference ?? "") || null},
                       transfer_tx = ${String(transfer.txHash ?? transfer.id ?? "") || null},
                       rate_tzs_usdc = ${d.amount_tzs > 0 ? usdc / d.amount_tzs : null},
                       metadata = metadata || ${sql.json(asJson({
                         swap: swapResult,
                         transfer,
                         omnibusBefore: { tzs: before.tzs, usdc: before.usdc },
                         omnibusAfter: { tzs: after.tzs, usdc: after.usdc },
                       }))}
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

  return NextResponse.json({ ok: true, checked: pending.length, results },
    { headers: { "cache-control": "no-store" } });
}
