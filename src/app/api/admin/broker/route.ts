import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { roleOf, ACTOR } from "@/lib/adminAuth";
import {
  brokerBalance, brokerEntries, brokerDaily, brokerBySecurity, recordPayout, FEE_SPLIT,
} from "@/lib/brokerLedger";
import { payoutFor } from "@/lib/opsContacts";

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
    const [balance, entries, daily, bySecurity, payout, account] = await Promise.all([
      brokerBalance(),
      brokerEntries(undefined, 60),
      brokerDaily(undefined, 30),
      brokerBySecurity(),
      payoutFor("fimco"),
      // Only CAPX is shown the wallet: it is an operational detail of where
      // the money sits, not part of the statement of what is owed.
      role === "admin"
        ? import("@/lib/brokerAccount").then((m) => m.brokerNtzsBalance()).catch(() => null)
        : null,
    ]);

    return NextResponse.json({
      ok: true, role, balance, entries, daily, bySecurity, payout, split: FEE_SPLIT,
      wallet: role === "admin" ? { address: account?.walletAddress ?? null, tzs: account?.tzs ?? 0 } : null,
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
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const amountTzs = Math.round(Number(body.amountTzs));
    const note = body.note ? String(body.note).slice(0, 300) : null;

    /*
     * Opening the fee account's wallet.
     *
     * nTZS creates the account on first contact but holds the wallet until
     * KYC clears, and under the reliance agreement CAPX attests its own. This
     * runs that and reports each step, because an account that exists with no
     * wallet and no explanation is the state it was stuck in.
     */
    if (body.action === "open-account") {
      const { openBrokerAccount, brokerAccountConfigured } = await import("@/lib/brokerAccount");
      if (!brokerAccountConfigured) {
        return NextResponse.json(
          { ok: false, error: "No identity is configured for the fee account (NTZS_OMNIBUS_NIDA or NTZS_BROKER_NIDA)." },
          { status: 409 });
      }
      const result = await openBrokerAccount();
      return NextResponse.json({ ok: !!result.wallet, ...result });
    }

    /*
     * A payment that actually moves the money.
     *
     * "send" disburses from the settlement account to the destination the
     * broker themselves saved, through the same nTZS rail a customer
     * withdrawal uses. "record" is the other case: a transfer already made
     * by hand, outside the app, that the ledger has to be told about — both
     * exist because both happen, and the ledger must match the bank either
     * way.
     *
     * The ledger row is written after the money has gone, not before. A row
     * claiming a payment that never left is worse than a payment with no row,
     * because the first is invisible and the second shows up as a difference
     * anybody can see.
     */
    if (body.action === "send") {
      const dest = await payoutFor("fimco");
      if (!dest) {
        return NextResponse.json(
          { ok: false, error: "FIMCO has not saved a payout account yet." }, { status: 409 });
      }
      const owed = await brokerBalance();
      if (!(amountTzs > 0)) return NextResponse.json({ ok: false, error: "Enter an amount." }, { status: 400 });
      if (amountTzs > owed) {
        return NextResponse.json(
          { ok: false, error: `Only ${Math.round(owed).toLocaleString()} TZS is owed.` }, { status: 409 });
      }

      const { payBroker } = await import("@/lib/brokerPayout");
      const sent = await payBroker(amountTzs, dest);

      const r = await recordPayout({
        amountTzs, by: ACTOR[role], ref: `payout:${sent.reference}`,
        note: [note, sent.label, sent.reference].filter(Boolean).join(" · ").slice(0, 300),
      });
      return NextResponse.json({
        ok: true, ...r, sent: true, reference: sent.reference,
        entries: await brokerEntries(undefined, 60),
      });
    }

    /*
     * Writing down a transfer that happened elsewhere is CAPX's alone: it
     * asserts money left a CAPX account, and the party whose balance it
     * reduces is not the party who can know that. Sending is different —
     * that is the broker taking their own earnings over a rail that will
     * refuse if the money is not there.
     */
    if (role !== "admin") {
      return NextResponse.json(
        { ok: false, code: "forbidden",
          error: "Only CAPX can record a payment made outside the app." }, { status: 403 });
    }

    const r = await recordPayout({ amountTzs, note, by: ACTOR[role] });
    return NextResponse.json({ ok: true, ...r, entries: await brokerEntries(undefined, 60) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not record the payout" },
      { status: 409 });
  }
}
