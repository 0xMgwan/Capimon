import { NextResponse } from "next/server";
import { getDeposit, rampStatus, swap, transferUsdc, ntzsConfigured } from "@/lib/ntzs";
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

  const pending = await sql<{ id: string; user_id: string; ntzs_deposit_id: string;
                             amount_tzs: number; metadata: { route?: string } }[]>`
    select id::text, user_id::text, ntzs_deposit_id, amount_tzs, metadata
      from capx.deposits
     where status in ('pending','uncertain') and ntzs_deposit_id is not null
     order by created_at asc
     limit 20`;

  const results: Record<string, string>[] = [];

  for (const d of pending) {
    try {
      const viaRamp = d.metadata?.route === "ramp";
      const remote = viaRamp ? await rampStatus(d.ntzs_deposit_id) : await getDeposit(d.ntzs_deposit_id);
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

      // Treasury collection is the ordinary path: shillings land in the partner
      // treasury and the account is credited in shillings. Nothing is converted
      // here — the user holds TZS and the swap happens when they buy, so the
      // rate they get is the rate at the moment they invest.
      if (d.metadata?.route === "treasury" || !d.metadata?.route) {
        await record([
          { userId: d.user_id, kind: "deposit", asset: "TZS", amount: d.amount_tzs.toString(),
            ref: `deposit:${d.id}`,
            metadata: { ntzsDepositId: d.ntzs_deposit_id, route: "treasury" } },
        ]);
        await sql`update capx.deposits
                     set status = 'settled', settled_at = now()
                   where id = ${d.id}`;
        results.push({ id: d.id, outcome: `credited ${d.amount_tzs.toLocaleString()} TZS` });
        continue;
      }

      // Ramp settles straight to USDC, so there is nothing to convert. The
      // wallet route lands in shillings and still needs the swap and transfer.
      let usdc = 0;
      let swapResult: unknown = null;
      let transfer: unknown = null;
      let omnibus: { before?: { tzs: number; usdc: number }; after?: { tzs: number; usdc: number } } = {};

      if (viaRamp) {
        usdc = Number(remote.usdcAmount ?? remote.usdc ?? remote.amountUsdc ?? 0);
        if (!(usdc > 0)) {
          results.push({ id: d.id, outcome: "settled but the USDC amount is not visible yet" });
          continue;
        }
      } else {
        const before = await omnibusBalances();
        swapResult = await swap({ userId: await omnibusUserId(), from: "NTZS", to: "USDC", amount: d.amount_tzs });
        const after = await omnibusBalances();
        usdc = Math.max(0, after.usdc - before.usdc);
        omnibus = { before: { tzs: before.tzs, usdc: before.usdc }, after: { tzs: after.tzs, usdc: after.usdc } };
        if (!(usdc > 0)) {
          results.push({ id: d.id, outcome: "swapped but no USDC visible yet" });
          continue;
        }
        transfer = await transferUsdc({ fromUserId: await omnibusUserId(), toAddress: treasury, amount: usdc });
      }

      // Keyed to the deposit, so a repeated settle is a no-op.
      await record([
        { userId: d.user_id, kind: "deposit", asset: "USDC", amount: usdc.toString(),
          ref: `deposit:${d.id}`, metadata: { amountTzs: d.amount_tzs, ntzsDepositId: d.ntzs_deposit_id } },
      ]);
      await sql`update capx.deposits
                   set status = 'settled', usdc_credited = ${usdc}, settled_at = now(),
                       swap_ref = ${String((swapResult as { id?: string; reference?: string } | null)?.id
                                          ?? (swapResult as { reference?: string } | null)?.reference ?? "") || null},
                       transfer_tx = ${String((transfer as { txHash?: string; id?: string } | null)?.txHash
                                          ?? (transfer as { id?: string } | null)?.id ?? "") || null},
                       rate_tzs_usdc = ${d.amount_tzs > 0 ? usdc / d.amount_tzs : null},
                       metadata = metadata || ${sql.json(asJson({
                         swap: swapResult,
                         transfer,
                         route: viaRamp ? "ramp" : "omnibus-wallet",
                         omnibus,
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
