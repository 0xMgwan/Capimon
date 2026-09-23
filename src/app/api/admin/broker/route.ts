import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { roleOf, ACTOR } from "@/lib/adminAuth";
import {
  brokerBalance, brokerEntries, brokerDaily, brokerBySecurity, recordPayout, FEE_SPLIT,
} from "@/lib/brokerLedger";

export const dynamic = "force-dynamic";

/**
 * The broker's account: what they have earned, what they have been paid, and
 * what is still owed.
 *
 * Both desks read it. The broker needs to see their own money, and CAPX needs
 * to see the same figure — a statement only one side can check is not a
 * statement, it is an assertion.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  const role = roleOf(req);
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  try {
    const [balance, entries, daily, bySecurity] = await Promise.all([
      brokerBalance(),
      brokerEntries(undefined, 60),
      brokerDaily(undefined, 30),
      brokerBySecurity(),
    ]);

    return NextResponse.json({
      ok: true, role, balance, entries, daily, bySecurity, split: FEE_SPLIT,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not read the broker account" },
      { status: 500 });
  }
}

/**
 * Records a payment to the broker.
 *
 * CAPX's alone. A party that can credit or settle its own account is not
 * keeping a ledger, and the whole point of this one is that both sides read
 * the same rows.
 */
export async function POST(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  const role = roleOf(req);
  if (role !== "admin") {
    return NextResponse.json(
      { ok: false, code: "forbidden", error: "Payouts are CAPX's to record." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const amountTzs = Math.round(Number(body.amountTzs));
    const note = body.note ? String(body.note).slice(0, 300) : null;
    const r = await recordPayout({ amountTzs, note, by: ACTOR[role] });
    return NextResponse.json({ ok: true, ...r, entries: await brokerEntries(undefined, 60) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not record the payout" },
      { status: 409 });
  }
}
