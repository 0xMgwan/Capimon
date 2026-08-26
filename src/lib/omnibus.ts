import "server-only";
import { upsertUser, createPartnerUser, getUser, rampBalance, probeCapabilities, NtzsError, type Capability } from "./ntzs";

/**
 * The single nTZS account CAPX collects into.
 *
 * Every user deposit lands here rather than in a wallet of their own, which is
 * what keeps the Tanzanian experience to "enter an amount, approve the prompt".
 * The consequence is that nTZS sees one customer — CAPX — so attribution lives
 * entirely in the `capx.deposits` table, and customer due diligence becomes
 * CAPX's obligation rather than something inherited from nTZS.
 */

export const OMNIBUS_EXTERNAL_ID = "capx-omnibus";
export const OMNIBUS_EMAIL = process.env.NTZS_OMNIBUS_EMAIL ?? "treasury@capx.finance";
const CONFIGURED_ID = process.env.NTZS_OMNIBUS_USER_ID ?? "";

let cached: string | null = CONFIGURED_ID || null;
let inflight: Promise<string> | null = null;

/**
 * Resolves the omnibus nTZS user id, provisioning it once if needed. Upstream
 * is idempotent on externalId, so this can never create a second one.
 */
export async function omnibusUserId(): Promise<string> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      const id = await provisionOmnibus();
      cached = id;
      return id;
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * Ensures the omnibus exists AND has a wallet — the deposit rail rejects a
 * walletless user. Provisions through the partners endpoint (which gives a
 * wallet) and falls back to the plain users endpoint only if that route is not
 * present. A missing wallet after both is a setup problem worth naming clearly
 * rather than surfacing later as an opaque "User has no wallet" on a deposit.
 */
async function provisionOmnibus(): Promise<string> {
  const input = { externalId: OMNIBUS_EXTERNAL_ID, email: OMNIBUS_EMAIL, name: "CAPX Treasury" };

  let user;
  try {
    user = await createPartnerUser(input);
  } catch (e) {
    // 404/405 → the partners endpoint is not on this deployment; fall back.
    const status = (e as NtzsError)?.status;
    if (status === 404 || status === 405) user = await upsertUser(input);
    else throw e;
  }

  // A freshly created wallet may not report its address on the create response;
  // confirm against a read before trusting it.
  if (!user.walletAddress) {
    const fresh = await getUser(user.id).catch(() => null);
    if (fresh && !fresh.walletAddress) {
      throw new NtzsError(
        "omnibus_no_wallet",
        "The CAPX omnibus nTZS account has no wallet. Create it once in the nTZS dashboard (or via " +
        "POST /api/v1/partners/users) and set NTZS_OMNIBUS_USER_ID to its id, then redeploy.",
        503,
      );
    }
  }
  return user.id;
}

/** Live nTZS and USDC balances sitting in the omnibus account. */
export async function omnibusBalances() {
  const id = await omnibusUserId();
  const u = await getUser(id);
  return { id, tzs: Number(u.balanceTzs ?? 0), usdc: Number(u.balanceUsdc ?? 0), walletAddress: u.walletAddress ?? null };
}

/**
 * Whatever nTZS-side balance can be read, without assuming which account holds
 * it. Reported as unavailable rather than zero when it cannot be read — a
 * missing reading and an empty treasury are very different facts.
 */
export async function ntzsTreasury(): Promise<
  { available: true; source: "omnibus" | "ramp-float"; tzs: number; usdc: number; walletAddress: string | null }
  | { available: false; reason: string }
> {
  const caps = await capabilities();
  if (caps.wallets.available) {
    try {
      const b = await omnibusBalances();
      return { available: true, source: "omnibus", tzs: b.tzs, usdc: b.usdc, walletAddress: b.walletAddress };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : "omnibus read failed" };
    }
  }
  if (caps.ramp.available) {
    try {
      const b = await rampBalance();
      return { available: true, source: "ramp-float", tzs: 0,
        usdc: Number(b.balance ?? b.usdc ?? 0), walletAddress: null };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : "ramp balance read failed" };
    }
  }
  return { available: false, reason: "No nTZS balance is readable with this key's capabilities." };
}

/**
 * Which collection route this key can use, cached for the process.
 *
 * `wallets` is granted per partner and off by default, so the omnibus-user path
 * is not always open. `ramp` collects mobile money straight to USDC with no
 * wallets at all, which suits an omnibus model just as well.
 */
let capsCache: { at: number; caps: Record<Capability, { available: boolean; detail?: string }> } | null = null;
const CAPS_TTL_MS = 300_000;

export async function capabilities(force = false) {
  if (!force && capsCache && Date.now() - capsCache.at < CAPS_TTL_MS) return capsCache.caps;
  const caps = await probeCapabilities(OMNIBUS_EXTERNAL_ID, OMNIBUS_EMAIL);
  capsCache = { at: Date.now(), caps };
  return caps;
}

export type CollectionRoute = "treasury" | "ramp" | "omnibus-wallet" | "none";

/**
 * Ramp first.
 *
 * Treasury collection reads better on paper — it would hold shillings and let
 * the conversion happen at purchase — but the deployed API rejects a deposit
 * with no userId regardless of what its spec says, so that route does not
 * actually work. Ramp is wallet-less by design, needs no user, and settles to
 * USDC in one step. It is the route that works, which beats the route that
 * ought to.
 */
export async function collectionRoute(): Promise<CollectionRoute> {
  const caps = await capabilities();
  // Hold the deposit as shillings and swap only at buy time, so owed and held
  // are both in TZS and the on-ramp spread can never book a phantom USDC
  // shortfall. This must land in the omnibus WALLET — the one the buy-time swap
  // draws from. The partner-treasury ("treasury") route holds shillings
  // somewhere the swap cannot reach, so it is not usable for swap-at-buy; it is
  // only a fallback when wallets is absent. Ramp settles straight to USDC and
  // is the last resort.
  if (caps.wallets.available) return "omnibus-wallet";
  if (caps.collections.available) return "treasury";
  if (caps.ramp.available) return "ramp";
  return "none";
}
