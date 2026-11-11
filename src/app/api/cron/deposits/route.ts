import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { cronPermitted } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Credits stablecoin deposits the minute they become safe, and nothing else.
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
 * repairs drift and supplies idle dollars, none of which wants to run sixty
 * times an hour. This does one query against an indexed column and, on the
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

  return NextResponse.json({ ok: true, settled },
    { headers: { "cache-control": "no-store" } });
}

export async function GET(req: Request) {
  return POST(req);
}
