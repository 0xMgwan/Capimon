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
   * Lapsed self-custody quotes, also on every run.
   *
   * A quote holds inventory for fifteen minutes so two buyers cannot both be
   * promised the last share. Left alone, an abandoned one holds it forever —
   * the reservation query already ignores expired rows, so this is only about
   * the status reading honestly on the desk.
   */
  try {
    const { expireStaleQuotes } = await import("@/lib/otc");
    did.otcExpired = await expireStaleQuotes();
  } catch (e) {
    did.otcExpired = { error: e instanceof Error ? e.message : "failed" };
  }

  /*
   * Any shilling swap whose own request could not finish telling the ledger
   * about it. Cheap when there is nothing to do — one indexed query — and
   * the thing it repairs is an unbacked liability, so it runs every tick
   * rather than once a day.
   */
  try {
    const { reconcileSwaps } = await import("@/lib/usOrders");
    did.strandedSwaps = await reconcileSwaps();
  } catch (e) {
    did.strandedSwaps = { error: e instanceof Error ? e.message : "failed" };
  }

  /*
   * Whether the next order could be funded at all.
   *
   * Everything the trading path needs is normally the customer's own money —
   * their shillings convert, sweep and buy. It only runs dry when that money
   * has drifted somewhere it cannot come back from, chiefly the ramp
   * settlement float, and the first sign of it used to be somebody's order
   * failing. Compared against the largest order of the past week, because
   * that is the size the next one is plausibly going to be.
   */
  try {
    const { reachableUsdc } = await import("@/lib/treasury");
    const reach = await reachableUsdc();
    if (reach) {
      const { db } = await import("@/lib/db");
      const [biggest] = await db()<{ usdc: string | null }[]>`
        select max(usdc_amount)::text as usdc from capx.orders
         where status = 'settled' and side = 'buy'
           and created_at > now() - interval '7 days'`.catch(() => [{ usdc: null }]);
      const typical = Math.max(10, Number(biggest?.usdc ?? 0));
      did.funding = { ...reach, typical };

      if (reach.total < typical) {
        const { sendMail } = await import("@/lib/mail");
        await sendMail({
          subject: "CAPX: the treasury cannot fund a typical order",
          text:
            `Everything the trading path can reach comes to ${reach.total.toFixed(2)} USDC — ` +
            `${reach.onChain.toFixed(2)} on-chain, ${reach.sweepable.toFixed(2)} in the omnibus, ` +
            `${reach.convertible.toFixed(2)} convertible from shillings — against a largest recent ` +
            `order of ${typical.toFixed(2)} USDC.\n\n` +
            `A customer's own money normally funds their own order, so this means dollars have ` +
            `drifted somewhere the trading path cannot reach: usually the nTZS settlement float, ` +
            `which backs balances but can only be spent outward on mobile-money payouts.\n\n` +
            `Either send USDC to the treasury on Base, or let the float drain through shilling ` +
            `withdrawals before it is topped up again.`,
        }).catch(() => {});
      }
    }
  } catch (e) {
    did.funding = { error: e instanceof Error ? e.message : "failed" };
  }

  /*
   * Shilling claims against the float, every tick.
   *
   * A payout rebalances on its way out, but a gap can open by other routes —
   * a sale that is never withdrawn, a corporate action, a provider funding
   * late — and none of those pass through a payout path. Cheap when the book
   * is square, which is the normal case.
   */
  try {
    const { rebalanceClaims } = await import("@/lib/liquidity");
    did.claims = await rebalanceClaims();
  } catch (e) {
    did.claims = { error: e instanceof Error ? e.message : "failed" };
  }

  /*
   * And the other direction: inventory back into the pool while the float can
   * carry the claim it creates. Absorbing without releasing is a one-way
   * ratchet that ends with a provider holding everything and nobody able to
   * buy it.
   */
  try {
    const { releaseInventory } = await import("@/lib/liquidity");
    did.released = await releaseInventory();
  } catch (e) {
    did.released = { error: e instanceof Error ? e.message : "failed" };
  }

  /*
   * The people who were told their withdrawal would follow.
   *
   * Every tick, because a queued payout is money somebody is waiting on and
   * the float refills whenever anybody deposits or buys. Cheap when the queue
   * is empty, which is the normal case: one indexed query returning nothing.
   */
  try {
    const { reconcileQueue } = await import("@/lib/withdrawalQueue");
    did.withdrawalQueue = await reconcileQueue();
  } catch (e) {
    did.withdrawalQueue = { error: e instanceof Error ? e.message : "failed" };
  }

  /*
   * Dividends and splits, once each morning.
   *
   * A multiplier moves rarely and never urgently, so this belongs on the
   * slowest tick that still catches it the same day. It reads the chain,
   * compares against what has been distributed, and credits the difference
   * to whoever holds the claim — the part that was silently accruing to CAPX
   * before, because a custodial claim is a number in the ledger and nothing
   * ever went back to it when the token grew.
   */
  if (hour === 8) {
    try {
      const { applyCorporateActions } = await import("@/lib/corporateActions");
      did.corporateActions = await applyCorporateActions();
    } catch (e) {
      did.corporateActions = { error: e instanceof Error ? e.message : "failed" };
    }

    /*
     * Whether the shillings owed have outrun the shillings held.
     *
     * Once a day is the right cadence: it moves with realised gains rather
     * than with the clock, and the thing it guards against — a customer
     * discovering it before the desk does — needs a morning's warning, not a
     * minute's. Silent unless there is something to say.
     */
    try {
      const { redemptionTripwire } = await import("@/lib/redemption");
      did.redemption = await redemptionTripwire();
    } catch (e) {
      did.redemption = { error: e instanceof Error ? e.message : "failed" };
    }
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
