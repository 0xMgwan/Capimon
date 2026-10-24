import { partnerRoute, send } from "@/lib/partnerApi";
import { NTZS_BASE, USDC_BASE } from "@/lib/assets";

export const dynamic = "force-dynamic";

/**
 * Where to send money, and in what.
 *
 * This should have existed the day stablecoin deposits did. That endpoint
 * takes a transaction hash and credits whatever the Transfer log moved to the
 * CAPX omnibus wallet — and nothing in the API ever said what that wallet
 * was, so the only way to find out was to ask a person. An integration step
 * that requires an email is an integration step that goes wrong quietly.
 *
 * The address is read live rather than configured here. It belongs to the
 * nTZS omnibus account, and a copy written into this file would be a second
 * source of truth for the one field where being out of date means a partner
 * sends money somewhere CAPX is not watching.
 *
 * Nothing here is secret — it is an address on a public chain, and anybody
 * can already see what it holds. It is behind a key because it is
 * operational, not because it is sensitive.
 */
export const GET = partnerRoute("GET /v1/settlement", {}, async () => {
  const { omnibusBalances } = await import("@/lib/omnibus");
  const omnibus = await omnibusBalances().catch(() => null);

  return send({
    ok: true,
    chain: { name: "Base", id: 8453 },
    /* Null when it cannot be read, never a stale constant: a partner must not
       be handed an address CAPX is no longer watching. */
    omnibus_address: omnibus?.walletAddress ?? null,
    tokens: [
      { symbol: "NTZS", address: NTZS_BASE, decimals: 18, credits_as: "TZS" },
      { symbol: "USDC", address: USDC_BASE, decimals: 6, credits_as: "USDC" },
    ],
    how: [
      "Send NTZS or USDC to omnibus_address on Base.",
      "Call POST /v1/deposits with { user, tx_hash, token } once it is mined.",
      "The amount credited is read from the transaction's own Transfer log, never from your request.",
      "The deposit is held as `pending` until the block is safe — batched to Ethereum, about a minute — then credited automatically.",
      "The hash is claimed the moment you submit it, so a retry returns the same deposit rather than a second one.",
    ],
    note: omnibus?.walletAddress
      ? "Send only NTZS or USDC on Base to this address. Anything else is not credited and cannot be returned automatically."
      : "The omnibus wallet address could not be read just now. Try again shortly rather than sending to a cached value.",
  });
});
