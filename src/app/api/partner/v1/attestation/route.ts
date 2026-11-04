import { partnerRoute, send } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Whether everything CAPX owes is actually held, right now.
 *
 * The same check the public proof page runs and the same one that pauses
 * trading when it fails — not a separate reassurance computed for partners.
 * A number produced only for the people asking is worth nothing to them.
 *
 * It compares shares against shares, per security, which is the only honest
 * unit for the question. A price move cannot leave a share position unbacked;
 * only a missing share can. The dollar totals are there for reporting, and
 * `covered` is the answer.
 *
 * Reported as unavailable rather than as zero when it cannot be established.
 * "I could not check" and "there is nothing there" are different answers and
 * a partner must never be handed the second when the first is true.
 */
export const GET = partnerRoute("GET /v1/attestation", {}, async () => {
  const { checkSolvency } = await import("@/lib/solvency");
  const s = await checkSolvency().catch(() => null);

  if (!s || s.unavailable) {
    return send({
      ok: true,
      status: "unavailable",
      reason: s?.unavailable ?? "Solvency could not be established just now.",
      note: "This is not a shortfall. It means the check could not be run — treat it as "
          + "unknown rather than as a pass or a fail.",
    });
  }

  return send({
    ok: true,
    status: s.ok ? "covered" : "shortfall",
    checked_at: new Date(s.checkedAt * 1000).toISOString(),
    /*
     * Per security, in shares. `covered` is held >= owed for that asset;
     * anything false is a real shortfall in the underlying rather than a
     * valuation question.
     */
    assets: s.assets.map((a) => ({
      security: a.asset,
      client_held: a.owed,
      in_custody: a.held,
      covered: a.covered,
    })),
    totals: {
      owed_usd: s.totals.owedUsd,
      held_usd: s.totals.heldUsd,
      shortfall_usd: s.totals.shortfallUsd,
      /* Securities CAPX holds that nobody is yet owed — what is left to sell. */
      inventory_usd: s.totals.inventoryUsd,
    },
    cash: {
      /* Where the dollars actually sit. They back balances from more than one
         place, and a partner reconciling against the chain will only find
         some of it there. */
      treasury_usdc: s.usdc?.treasury ?? 0,
      ramp_float_usdc: s.usdc?.rampFloat ?? 0,
      omnibus_usdc: s.usdc?.omnibus ?? 0,
    },
    usd_per_tzs: s.usdPerTzs,
    note: "Shares are compared against shares, per security, because that is the only unit in "
        + "which the question has an answer: a price move cannot leave a position unbacked. "
        + "When this reports a shortfall, CAPX pauses buying on its own — you do not need to "
        + "gate on it, but you may want to show it.",
    public_proof: "https://www.capx.broker/proof",
  });
});
