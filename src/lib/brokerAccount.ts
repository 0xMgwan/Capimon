import "server-only";
import { upsertUser, getUser, attestKyc, retroKyc } from "./ntzs";

/**
 * A second nTZS account, holding nothing but the broker's fees.
 *
 * Their share used to sit in the omnibus alongside customer money until
 * somebody moved it, which made one balance mean three things — customer
 * float, CAPX revenue, and money owed to FIMCO — and left "is the float
 * healthy" a question you had to do arithmetic to answer.
 *
 * So the sweep now has two legs. CAPX's share goes to CAPX's wallet, the
 * broker's goes here, and a withdrawal by the broker is paid from this
 * account. What FIMCO see on their portal is unchanged: the ledger is still
 * the record of what they are owed, and this is where those shillings
 * actually sit.
 *
 * Provisioned the same way as the omnibus, and optional: without the identity
 * to open it the broker leg is skipped and their fees stay in the omnibus,
 * which is where they were before. A missing account must never mean a
 * missing fee.
 *
 * It opens on CAPX's own identity rather than FIMCO's, which is honest about
 * what it is today: a CAPX account earmarked for money CAPX owes. The
 * separation being bought is of funds, not of ownership. An account in
 * FIMCO's name would be the stronger arrangement and is the eventual answer,
 * but it is theirs to agree to in writing, and this does not wait on that.
 *
 * So every field except the external id falls back to the omnibus. Upstream
 * is idempotent on externalId, so a different one is exactly what makes this
 * a second account rather than a second name for the first.
 */
const EXTERNAL_ID = process.env.NTZS_BROKER_EXTERNAL_ID ?? "capx-broker-fees";
const EMAIL = process.env.NTZS_BROKER_EMAIL ?? process.env.NTZS_OMNIBUS_EMAIL ?? "treasury@capx.finance";
const NAME = process.env.NTZS_BROKER_NAME
  ?? `${process.env.NTZS_OMNIBUS_NAME ?? "CAPX Treasury"} · broker fees`;
const NIDA = process.env.NTZS_BROKER_NIDA ?? process.env.NTZS_OMNIBUS_NIDA ?? "";
const PHONE = process.env.NTZS_BROKER_PHONE ?? process.env.NTZS_OMNIBUS_PHONE ?? "";
const CONFIGURED_ID = process.env.NTZS_BROKER_USER_ID ?? "";
const VERIFIED_BY = process.env.NTZS_KYC_VERIFIED_BY ?? EMAIL;

/** Whether there is enough to open the account at all. */
export const brokerAccountConfigured = !!(CONFIGURED_ID || (EMAIL && (NIDA || PHONE)));

let cached: string | null = CONFIGURED_ID || null;
let inflight: Promise<string> | null = null;

/**
 * Opens the account and gets it a wallet, saying what happened at each step.
 *
 * nTZS issues the wallet once an account has cleared KYC, and under the
 * reliance agreement CAPX attests its own. The account was created without a
 * wallet because the attestation never ran or was refused, and both were
 * previously swallowed — so this records the reason for each attempt and
 * reports them together rather than leaving an account that exists, has no
 * wallet, and does not say why.
 */
export type Provisioning = {
  id: string | null;
  wallet: string | null;
  kycStatus: string | null;
  steps: { step: string; ok: boolean; detail: string }[];
};

async function provisionVerbose(): Promise<Provisioning> {
  const steps: Provisioning["steps"] = [];
  const note = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail });
  const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

  const user = await upsertUser({
    externalId: EXTERNAL_ID,
    email: EMAIL,
    name: NAME,
    country: "TZ",
    ...(NIDA ? { nidaNumber: NIDA } : {}),
    ...(PHONE ? { phone: PHONE } : {}),
  });
  note("account", true, `id ${user.id}, external id ${EXTERNAL_ID}`);

  let latest = await getUser(user.id).catch(() => null);
  let wallet = user.walletAddress ?? latest?.walletAddress ?? null;
  if (wallet) note("wallet", true, "already issued");

  if (!NIDA) {
    note("identity", false,
      "No NIDA configured (NTZS_BROKER_NIDA or NTZS_OMNIBUS_NIDA). nTZS cannot verify the "
      + "account, so it never issues a wallet.");
  }

  /*
   * The same two routes the omnibus takes, in the same order: attach the
   * identity to an account still sitting at "none", then attest it. Both are
   * idempotent, so running this again on a half-open account is safe.
   */
  if (!wallet && NIDA && PHONE && (latest?.kycStatus ?? user.kycStatus ?? "none") === "none") {
    try {
      const done = await retroKyc(user.id, { nidaNumber: NIDA, phone: PHONE });
      wallet = done.walletAddress ?? wallet;
      note("kyc", true, wallet ? "identity attached, wallet issued" : "identity attached");
    } catch (e) {
      note("kyc", false, reason(e));
    }
  }

  if (!wallet && NIDA) {
    try {
      const attested = await attestKyc(user.id, {
        decision: "approved",
        country: "TZ",
        idType: "NATIONAL_ID",
        idNumber: NIDA,
        fullName: NAME,
        reference: EXTERNAL_ID,
        verifiedBy: VERIFIED_BY,
      });
      wallet = attested.walletAddress ?? wallet;
      note("attestation", true, wallet ? "accepted, wallet issued" : "accepted");
    } catch (e) {
      note("attestation", false, reason(e));
    }
  }

  if (!wallet) {
    latest = await getUser(user.id).catch(() => null);
    wallet = latest?.walletAddress ?? null;
    if (wallet) note("wallet", true, "issued, found on a re-read");
  }

  return { id: user.id, wallet, kycStatus: latest?.kycStatus ?? user.kycStatus ?? null, steps };
}

/** Runs provisioning and reports it, without throwing. For the desk. */
export async function openBrokerAccount(): Promise<Provisioning> {
  const result = await provisionVerbose();
  if (result.wallet && result.id) cached = result.id;
  return result;
}

async function provision(): Promise<string> {
  const r = await provisionVerbose();
  if (!r.wallet) {
    const why = r.steps.filter((s) => !s.ok).map((s) => `${s.step}: ${s.detail}`).join(" · ");
    throw new Error(
      `The broker fee account has no nTZS wallet yet.${why ? ` ${why}` : ""} `
      + "It carries the same identity as the omnibus, which nTZS may decline to verify twice.",
    );
  }
  return r.id!;
}

export async function brokerNtzsUserId(): Promise<string> {
  if (!brokerAccountConfigured) throw new Error("No broker fee account is configured.");
  if (cached) return cached;
  inflight ??= provision()
    .then((id) => { cached = id; return id; })
    .finally(() => { inflight = null; });
  return inflight;
}

export type BrokerAccount = { id: string; tzs: number; walletAddress: string | null };

/** The account's own balance, or null when there is no account to read. */
export async function brokerNtzsBalance(): Promise<BrokerAccount | null> {
  if (!brokerAccountConfigured) return null;
  try {
    const id = await brokerNtzsUserId();
    const u = await getUser(id);
    return { id, tzs: Number(u.balanceTzs ?? 0), walletAddress: u.walletAddress ?? null };
  } catch {
    // Unreadable is not empty: the caller decides what to do about it, and
    // reporting zero would invite paying the broker out of customer float.
    return null;
  }
}
