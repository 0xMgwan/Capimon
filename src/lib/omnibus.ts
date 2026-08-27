import "server-only";
import { upsertUser, getUser, rampBalance, probeCapabilities, attestKyc, retroKyc,
         NtzsError, type Capability } from "./ntzs";

/**
 * The single nTZS account CAPX collects into.
 *
 * Every user deposit lands here rather than in a wallet of their own, which is
 * what keeps the Tanzanian experience to "enter an amount, approve the prompt".
 * The consequence is that nTZS sees one customer — CAPX — so attribution lives
 * entirely in the `capx.deposits` table, and customer due diligence becomes
 * CAPX's obligation rather than something inherited from nTZS.
 */

// Overridable because POST /users is idempotent on externalId: an account
// already stuck at kyc "none" may not upgrade when identity fields are added
// later, and a new externalId provisions a fresh, fully-KYC'd one.
export const OMNIBUS_EXTERNAL_ID = process.env.NTZS_OMNIBUS_EXTERNAL_ID ?? "capx-omnibus";
export const OMNIBUS_EMAIL = process.env.NTZS_OMNIBUS_EMAIL ?? "treasury@capx.finance";
const CONFIGURED_ID = process.env.NTZS_OMNIBUS_USER_ID ?? "";
// Identity for the omnibus account. Without these, KYC stays pending_review
// and nTZS never issues the wallet that deposits and transfers require.
const OMNIBUS_NAME = process.env.NTZS_OMNIBUS_NAME ?? "CAPX Treasury";
const OMNIBUS_NIDA = process.env.NTZS_OMNIBUS_NIDA ?? "";
const OMNIBUS_PHONE = process.env.NTZS_OMNIBUS_PHONE ?? "";
// Who signed off the verification, recorded upstream with the attestation.
const KYC_VERIFIED_BY = process.env.NTZS_KYC_VERIFIED_BY ?? OMNIBUS_EMAIL;

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

/** The identity nTZS is asked to KYC. One definition, used everywhere. */
export function omnibusIdentity() {
  return {
    externalId: OMNIBUS_EXTERNAL_ID,
    email: OMNIBUS_EMAIL,
    name: OMNIBUS_NAME,
    country: "TZ",
    ...(OMNIBUS_NIDA ? { nidaNumber: OMNIBUS_NIDA } : {}),
    ...(OMNIBUS_PHONE ? { phone: OMNIBUS_PHONE } : {}),
  };
}

/** Which identity fields are configured — booleans only; NIDA is personal data. */
export const omnibusIdentityConfigured = {
  externalId: OMNIBUS_EXTERNAL_ID,
  nida: OMNIBUS_NIDA.length > 0,
  phone: OMNIBUS_PHONE.length > 0,
};

/**
 * Ensures the omnibus exists AND has a wallet, which is what deposits, swaps
 * and transfers all actually require.
 */
async function provisionOmnibus(): Promise<string> {
  let attestError: string | null = null;
  const user = await upsertUser(omnibusIdentity());

  // The create response can lag the wallet; confirm against a read.
  let wallet = user.walletAddress ?? (await getUser(user.id).catch(() => null))?.walletAddress;

  /*
   * No wallet yet. Create-user only issues one for partners with platform-run
   * instant NIDA verification enabled, which this account does not have — so
   * take the documented alternative and attest the identity ourselves. CAPX
   * verifies its own customers, and under a KYC reliance agreement that
   * attestation issues the wallet on the call itself.
   *
   * Retro-KYC first, since an account already sitting at "none" is exactly what
   * it is for; attestation second. Both are skipped without an identity to
   * attest, and a missing reliance agreement is reported rather than retried.
   */
  if (!wallet && OMNIBUS_NIDA) {
    if ((user.kycStatus ?? "none") === "none" && OMNIBUS_PHONE) {
      const done = await retroKyc(user.id, { nidaNumber: OMNIBUS_NIDA, phone: OMNIBUS_PHONE })
        .catch(() => null);
      wallet = done?.walletAddress ?? wallet;
    }
    if (!wallet) {
      const attested = await attestKyc(user.id, {
        decision: "approved",
        country: "TZ",
        idType: "NATIONAL_ID",
        idNumber: OMNIBUS_NIDA,
        fullName: OMNIBUS_NAME,
        reference: OMNIBUS_EXTERNAL_ID,
        verifiedBy: KYC_VERIFIED_BY,
      }).catch((e) => { attestError = e instanceof Error ? e.message : String(e); return null; });
      wallet = attested?.walletAddress ?? wallet;
    }
    if (!wallet) wallet = (await getUser(user.id).catch(() => null))?.walletAddress ?? null;
  }

  if (!wallet) {
    // nTZS holds the wallet until compliance clears the account, and says so in
    // the create response. Pass its own words through rather than guessing at a
    // cause — identity fields do not shortcut this, and suggesting they might
    // sent us chasing the wrong fix for a while.
    const status = String(user.kycStatus ?? "unknown");
    const upstream = [user.message, user.nextStep && `Next step: ${user.nextStep}.`, attestError]
      .filter(Boolean).join(" ");
    throw new NtzsError(
      "omnibus_no_wallet",
      `The CAPX nTZS account (${user.id}) has no wallet yet — KYC is "${status}". ` +
      (upstream || "nTZS activates wallets once the account clears compliance review."),
      503,
    );
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
        usdc: Number(b.usdcBalance ?? b.balance ?? b.usdc ?? 0), walletAddress: null };
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
  const caps = await probeCapabilities(omnibusIdentity());
  // The probe creates the account but does not attest it, so it can report no
  // wallet for an omnibus that provisioning would give one to. Ask the
  // provisioning path before recording the answer.
  if (!caps.wallets.available) {
    const id = await omnibusUserId().catch(() => null);
    if (id) caps.wallets = { available: true, detail: id };
  }
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
/** Negative cache, so a wallet-less deployment does not re-probe on every call. */
let noWalletUntil = 0;
const NO_WALLET_TTL_MS = 60_000;

export async function collectionRoute(): Promise<CollectionRoute> {
  /*
   * Prefer the omnibus wallet whenever one actually exists: deposits rest as
   * shillings and convert only at buy time, which keeps owed and held in the
   * same unit and lets the treasury be funded by transfer.
   *
   * Asked of the wallet itself rather than the capability probe. The probe is
   * cached for five minutes and reports what was true when it ran, so right
   * after provisioning it still says "no wallet" — routing money on that would
   * mean ignoring a wallet we just created.
   */
  if (Date.now() >= noWalletUntil) {
    const hasWallet = await omnibusUserId().then(() => true).catch(() => false);
    if (hasWallet) return "omnibus-wallet";
    noWalletUntil = Date.now() + NO_WALLET_TTL_MS;
  }

  // No wallet: the ramp collects mobile money straight to USDC without one.
  const caps = await capabilities();
  if (caps.ramp.available) return "ramp";
  if (caps.collections.available) return "treasury";
  return "none";
}
