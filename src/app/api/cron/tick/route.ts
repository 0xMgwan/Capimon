import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { cronPermitted } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One scheduled job that decides for itself what is due.
 *
 * Three separate crons — standing orders hourly, the oracle each morning, the
 * portfolio note twice a day — were three schedules to keep in step and three
 * entries against the account's limit, for work that mostly consists of
 * asking whether there is anything to do. So there is one invocation an hour
 * and it asks all three questions.
 *
 * The cheap question comes first and is usually answered by an index: a
 * `next_run <= now()` against no rows costs almost nothing, which is what
 * most of the twenty-four hourly runs will be. The expensive ones are gated
 * on the clock in East African time, so they fire once each and a manual run
 * does whatever the scheduler would have done at that hour rather than
 * something different.
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

  // 1. Standing orders. Every hour, because a plan should land near the time
  //    it was promised, and because an hour when the market was halted or the
  //    feed was down should not cost anybody their instalment.
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

  return NextResponse.json({ ok: true, ...did }, { headers: { "cache-control": "no-store" } });
}

export const POST = GET;
