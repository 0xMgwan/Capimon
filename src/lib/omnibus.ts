import "server-only";
import { upsertUser, getUser, probeCapabilities, type Capability } from "./ntzs";

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
      const user = await upsertUser({ externalId: OMNIBUS_EXTERNAL_ID, email: OMNIBUS_EMAIL, name: "CAPX Treasury" });
      cached = user.id;
      return user.id;
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

/** Live nTZS and USDC balances sitting in the omnibus account. */
export async function omnibusBalances() {
  const id = await omnibusUserId();
  const u = await getUser(id);
  return { id, tzs: Number(u.balanceTzs ?? 0), usdc: Number(u.balanceUsdc ?? 0), walletAddress: u.walletAddress ?? null };
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
 * Treasury collection is preferred: it needs only `collections`, keeps the money
 * in the account CAPX already controls, and leaves attribution in the CAPX
 * ledger where it belongs. Ramp is the fallback for keys without `collections`,
 * and the per-user wallet path is only used where `wallets` was granted.
 */
export async function collectionRoute(): Promise<CollectionRoute> {
  const caps = await capabilities();
  if (caps.collections.available) return "treasury";
  if (caps.ramp.available) return "ramp";
  if (caps.wallets.available) return "omnibus-wallet";
  return "none";
}
