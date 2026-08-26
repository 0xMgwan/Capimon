import "server-only";
import { upsertUser, getUser } from "./ntzs";

/**
 * The single nTZS account CAPX collects into.
 *
 * Every user deposit lands here rather than in a wallet of their own, which is
 * what keeps the Tanzanian experience to "enter an amount, approve the prompt".
 * The consequence is that nTZS sees one customer — CAPX — so attribution lives
 * entirely in the `capx.deposits` table, and customer due diligence becomes
 * CAPX's obligation rather than something inherited from nTZS.
 */

const OMNIBUS_EXTERNAL_ID = "capx-omnibus";
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
      const email = process.env.NTZS_OMNIBUS_EMAIL ?? "treasury@capx.finance";
      const user = await upsertUser({ externalId: OMNIBUS_EXTERNAL_ID, email, name: "CAPX Treasury" });
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
