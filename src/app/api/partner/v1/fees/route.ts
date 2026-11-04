import { partnerRoute, send } from "@/lib/partnerApi";
import { FEE_BPS, BROKER_FEE_BPS, CAPX_FEE_BPS, feeEnabled } from "@/lib/fees";

export const dynamic = "force-dynamic";

/**
 * What CAPX charges, stated once.
 *
 * Read from the same constants the trades are priced with, so this cannot
 * drift from what is actually taken — a published rate card maintained by
 * hand is a rate card that is eventually wrong.
 *
 * The split is shown because a partner reselling this is asked where the
 * money goes, and "we don't know" is a poor answer to give their own
 * customer or their own regulator.
 */
export const GET = partnerRoute("GET /v1/fees", {}, async ({ caller }) => {
  const partnerShare = caller.partner.feeBps;

  return send({
    ok: true,
    trading: {
      bps: feeEnabled ? FEE_BPS : 0,
      percent: feeEnabled ? FEE_BPS / 100 : 0,
      charged: "On both buys and sells, on the cash leg.",
      dse: "Taken in shillings and quoted before the order. A buy is charged on what the "
         + "customer spends, a sell on the proceeds.",
      us: "Taken in dollars inside the swap, by the router, even when the order was paid for "
        + "in shillings. A buy is charged on the dollars going in, a sell on the dollars "
        + "coming out.",
      split: {
        broker_bps: BROKER_FEE_BPS,
        capx_bps: CAPX_FEE_BPS,
        your_bps: partnerShare,
        note: "Your share comes out of CAPX's slice, not on top of the customer's fee.",
      },
    },
    /*
     * Named rather than silently omitted. A partner who does not see a line
     * for conversion will assume there is no cost in it, and there is: the
     * nTZS swap carries its own spread, which is not CAPX's to quote.
     */
    conversion: {
      bps: 0,
      note: "CAPX adds nothing to a currency conversion. The nTZS swap carries its own spread, "
          + "which is priced by nTZS at the moment it runs and is visible in the difference "
          + "between what went in and what came out.",
    },
    withdrawals: {
      bps: 0,
      note: "CAPX adds nothing. The payout rail charges its own fee, quoted by nTZS per payout "
          + "and returned on the withdrawal as `fee_tzs`.",
    },
    deposits: {
      bps: 0,
      note: "CAPX adds nothing. A mobile money collection carries the provider's own charge; a "
          + "stablecoin transfer costs only Base gas, which you pay when you send it.",
    },
  });
});
