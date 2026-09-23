import "server-only";
import { upsertUser, getUser, attestKyc } from "./ntzs";

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
 */
const EXTERNAL_ID = process.env.NTZS_BROKER_EXTERNAL_ID ?? "capx-broker-fimco";
const EMAIL = process.env.NTZS_BROKER_EMAIL ?? "";
const NAME = process.env.NTZS_BROKER_NAME ?? "FIMCO fee account";
const NIDA = process.env.NTZS_BROKER_NIDA ?? "";
const PHONE = process.env.NTZS_BROKER_PHONE ?? "";
const CONFIGURED_ID = process.env.NTZS_BROKER_USER_ID ?? "";
const VERIFIED_BY = process.env.NTZS_KYC_VERIFIED_BY ?? EMAIL;

/** Whether there is enough to open the account at all. */
export const brokerAccountConfigured = !!(CONFIGURED_ID || (EMAIL && (NIDA || PHONE)));

let cached: string | null = CONFIGURED_ID || null;
let inflight: Promise<string> | null = null;

async function provision(): Promise<string> {
  const user = await upsertUser({
    externalId: EXTERNAL_ID,
    email: EMAIL,
    name: NAME,
    country: "TZ",
    ...(NIDA ? { nidaNumber: NIDA } : {}),
    ...(PHONE ? { phone: PHONE } : {}),
  });

  let wallet = user.walletAddress ?? (await getUser(user.id).catch(() => null))?.walletAddress;

  // Same route the omnibus takes: without instant NIDA verification on the
  // partner account, the wallet is issued on an attestation we make ourselves.
  if (!wallet && NIDA) {
    const attested = await attestKyc(user.id, {
      decision: "approved",
      country: "TZ",
      idType: "NATIONAL_ID",
      idNumber: NIDA,
      fullName: NAME,
      reference: EXTERNAL_ID,
      verifiedBy: VERIFIED_BY,
    }).catch(() => null);
    wallet = attested?.walletAddress ?? (await getUser(user.id).catch(() => null))?.walletAddress ?? null;
  }

  if (!wallet) {
    throw new Error(
      "The broker fee account has no nTZS wallet yet — nTZS holds it until the account clears compliance.",
    );
  }
  return user.id;
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
