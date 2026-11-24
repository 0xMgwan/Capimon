import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { cronPermitted } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Credits stablecoin deposits soon after they become safe, and nothing else.
 *
 * Runs every five minutes, which is a retreat from every minute and the
 * reason is billing rather than design. A query a minute means the Postgres
 * compute never goes idle, so it bills every hour of every day — about 720 a
 * month against a free allowance of roughly 192. Thirteen days after this
 * cron went in, the ledger's host hit its quota and began refusing
 * connections, which took sign-in, custody and solvency down with it.
 *
 * Five minutes is not a fix on its own: it only pays off if the database is
 * allowed to suspend faster than it is woken, so the provider's idle timeout
 * has to be shorter than this interval. The honest fix for a system holding
 * client money is a plan that does not suspend at all.
 *
 * A transfer into the omnibus is spendable about a minute or two after it is
 * mined — once the batch carrying it reaches Ethereum and Base's `safe` head
 * passes its block. The settlement sweep that notices ran every fifteen
 * minutes, so money that had been creditable for thirteen of them was still
 * showing as pending to the person who sent it. That is not caution, it is
 * just latency wearing caution's clothes: the wait that protects anybody
 * ended minutes earlier.
 *
 * So the confirmation rule is untouched — a deposit is still credited only
 * once its block is safe, and a reorg before that still fails it — and only
 * the noticing gets faster.
 *
 * Deliberately narrow. The fifteen-minute sweep also reconciles swaps,
 * repairs drift and supplies idle dollars, none of which wants to run on
 * this cadence. This does one query against an indexed column and, on the
 * overwhelmingly common path where nothing is pending, returns having
 * touched no chain and no third party.
 */
export async function POST(req: Request) {
  if (!cronPermitted(req)) {
    return NextResponse.json({ ok: false, error: "not permitted" }, { status: 401 });
  }
  if (!dbConfigured) {
    return NextResponse.json({ ok: true, skipped: "no database" });
  }

  const { settleStablecoinDeposits } = await import("@/lib/stablecoinDeposits");
  const settled = await settleStablecoinDeposits().catch(
    (e) => ({ error: e instanceof Error ? e.message : "settle failed" }));

  /*
   * And the mobile-money collections, which had the same problem for a
   * different reason.
   *
   * A stablecoin transfer waits on a batch reaching Ethereum. A collection
   * waits on nothing — the money is at nTZS the moment the customer approves
   * the prompt, and the only thing between that and a credit is CAPX asking.
   * Asking every fifteen minutes meant somebody who paid on their phone and
   * watched it leave their mobile money balance sat looking at nothing for a
   * quarter of an hour.
   *
   * Narrowed to collections young enough that somebody is plausibly still
   * waiting, because the full sweep keeps watching expired prompts forever
   * and asking nTZS about those on a loop would be rude and pointless.
   */
  const { settlePending } = await import("@/app/api/ntzs/settle/route");
  const collections = await settlePending(undefined, { maxAgeMs: 30 * 60_000 })
    .then((r) => ({ checked: r.checked, results: r.results }))
    .catch((e) => ({ error: e instanceof Error ? e.message : "collections failed" }));

  return NextResponse.json({ ok: true, settled, collections },
    { headers: { "cache-control": "no-store" } });
}

export async function GET(req: Request) {
  return POST(req);
}
