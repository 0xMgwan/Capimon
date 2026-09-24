import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { cronPermitted } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One scheduled job that decides for itself what is due.
 *
 * Three separate crons — standing orders, the oracle each morning, the
 * portfolio note twice a day — were three schedules to keep in step and three
 * entries against the account's limit. There is one job instead, and it asks
 * all three questions.
 *
 * It runs three times a day rather than hourly, at the hours that actually
 * mean something: 08:00 for the price refresh, 09:00 for the standing orders
 * and the morning note, 18:00 for the evening one. Hourly spent twenty-one
 * runs a day discovering there was nothing to do.
 *
 * The cost is patience. A standing order that cannot fill at nine — an empty
 * balance, a halted market — waits until six rather than until ten, and a
 * missed price refresh waits until tomorrow. Both are survivable: a mark has
 * four days before it stops trading, and a missed instalment is a
 * notification rather than a loss.
 *
 * Everything is gated on the clock in East African time, so a manual run does
 * whatever the scheduler would have done at that hour rather than something
 * different.
 */
function hourEat(): number {
  return Number(new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", hour12: false,
  }));
}

export async function GET(req: Request) {
  if (!cronPermitted(req)) {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });

  const hour = hourEat();
  const did: Record<string, unknown> = { hour };

  // 1. Standing orders, on every run: the query is an index lookup against a
  //    handful of rows, so asking costs nothing when the answer is none.
  try {
    const { runDue } = await import("@/lib/recurring");
    did.recurring = await runDue();
  } catch (e) {
    did.recurring = { error: e instanceof Error ? e.message : "failed" };
  }

  /*
   * 2. The marks settlement prices against, once each morning before the
   *    portfolio note goes out — a summary computed from yesterday's prices
   *    would be worse than no summary.
   */
  if (hour === 8) {
    try {
      const { publishDsePrice } = await import("@/lib/oracle");
      const { dseSecurities } = await import("@/lib/dseSecurities");
      const list = await dseSecurities().catch(() => []);
      did.oracle = await Promise.all(list
        .filter((d) => d.status !== "suspended")
        .map(async (d) => {
          try { return { symbol: d.symbol, ...(await publishDsePrice(d.symbol)) }; }
          catch (e) { return { symbol: d.symbol, ok: false, reason: e instanceof Error ? e.message : "failed" }; }
        }));
    } catch (e) {
      did.oracle = { error: e instanceof Error ? e.message : "failed" };
    }
  }

  // 3. The portfolio note: before the market opens, and after it has closed.
  if (hour === 9 || hour === 18) {
    try {
      const { pushConfigured } = await import("@/lib/push");
      if (pushConfigured) {
        const { sendDigest } = await import("@/lib/digest");
        did.digest = await sendDigest(hour === 9 ? "morning" : "evening");
      } else {
        did.digest = { skipped: "push not configured" };
      }
    } catch (e) {
      did.digest = { error: e instanceof Error ? e.message : "failed" };
    }
  }

  /*
   * Recorded whether or not anything happened.
   *
   * The empty runs are the point: a standing order that never executes looks
   * the same as a scheduler that never fired, and only a timestamp tells them
   * apart.
   */
  const { recordRun } = await import("@/lib/jobRuns");
  await recordRun("tick", true, did);

  return NextResponse.json({ ok: true, ...did }, { headers: { "cache-control": "no-store" } });
}

export const POST = GET;
