import "server-only";
import { randomBytes } from "crypto";
import { verifyMessage } from "viem";
import { db, dbConfigured, migrate } from "./db";

/**
 * Binding somebody's own wallet to their verified CAPX account.
 *
 * This is where the KYC perimeter reaches self-custody. CAPX will only send a
 * tokenised share to an address that has been bound here against an approved
 * account, which keeps one answer to "who did we sell this to" whether the
 * buyer holds it in the app or in MetaMask.
 *
 * Proof is a signature over a nonce we issued. Anyone can type an address;
 * only the person holding its key can sign for it, and the nonce stops a
 * signature captured elsewhere from being replayed here.
 *
 * What this does and does not claim: it establishes that a verified customer
 * controls this address at the moment of linking. It does not follow the token
 * afterwards. Whether a share can move on from there to an address CAPX never
 * checked is a property of the token, not of this table — see the note in
 * `otc.ts`.
 */

const NONCE_TTL_MINUTES = 10;

export type LinkedWallet = { address: string; verifiedAt: string };

const normalise = (a: string) => a.trim().toLowerCase();
const isAddress = (a: string) => /^0x[0-9a-f]{40}$/.test(normalise(a));

/** What the customer is asked to sign. Readable, because they will read it. */
export function linkMessage(address: string, nonce: string): string {
  return [
    "CAPX — link this wallet",
    "",
    "Signing this proves you control this address so CAPX can send tokenised",
    "shares to it. It does not approve any transaction and cannot move funds.",
    "",
    `Address: ${normalise(address)}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

/** Issues a challenge for an address, replacing any earlier one. */
export async function issueNonce(userId: string, address: string): Promise<{ nonce: string; message: string }> {
  if (!isAddress(address)) throw new Error("That is not a Base address.");
  await migrate();
  const sql = db();
  const addr = normalise(address);
  const nonce = randomBytes(16).toString("hex");

  /*
   * One row per (account, address), refreshed rather than accumulated. A table
   * that grows a row per attempt makes "is this linked" a question about which
   * row you read, which is not a question this should ever have.
   */
  const updated = await sql`
    update capx.wallet_links
       set nonce = ${nonce}, nonce_at = now(), revoked_at = null
     where user_id = ${userId}::uuid and lower(address) = ${addr}
    returning id`;
  if (!updated.length) {
    await sql`
      insert into capx.wallet_links (user_id, address, nonce, nonce_at)
      values (${userId}::uuid, ${addr}, ${nonce}, now())`;
  }

  return { nonce, message: linkMessage(addr, nonce) };
}

/**
 * Checks the signature and, if it holds, marks the address verified.
 *
 * An address already bound to a different account is refused outright rather
 * than moved. Two accounts sharing one address would leave the KYC record
 * ambiguous at exactly the moment it matters, and the honest resolution — which
 * of the two people actually holds the key — is not one this can make.
 */
export async function verifyLink(
  userId: string,
  address: string,
  signature: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isAddress(address)) return { ok: false, error: "That is not a Base address." };
  await migrate();
  const sql = db();
  const addr = normalise(address);

  const [taken] = await sql<{ user_id: string }[]>`
    select user_id::text from capx.wallet_links
     where lower(address) = ${addr} and verified_at is not null and revoked_at is null`;
  if (taken && taken.user_id !== userId) {
    return { ok: false, error: "That address is already linked to another CAPX account." };
  }

  const [row] = await sql<{ nonce: string | null; fresh: boolean }[]>`
    select nonce, (nonce_at > now() - make_interval(mins => ${NONCE_TTL_MINUTES})) as fresh
      from capx.wallet_links
     where user_id = ${userId}::uuid and lower(address) = ${addr}`;
  if (!row?.nonce || !row.fresh) {
    return { ok: false, error: "That request has expired. Start again." };
  }

  const valid = await verifyMessage({
    address: addr as `0x${string}`,
    message: linkMessage(addr, row.nonce),
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!valid) return { ok: false, error: "That signature does not match the address." };

  // The nonce is spent whether or not anything else happens next.
  await sql`
    update capx.wallet_links
       set verified_at = now(), nonce = null, revoked_at = null
     where user_id = ${userId}::uuid and lower(address) = ${addr}`;

  return { ok: true };
}

/** The addresses this account has proved it controls. */
export async function linkedWallets(userId: string): Promise<LinkedWallet[]> {
  if (!dbConfigured) return [];
  await migrate();
  const rows = await db()<{ address: string; verified_at: string }[]>`
    select address, verified_at from capx.wallet_links
     where user_id = ${userId}::uuid and verified_at is not null and revoked_at is null
     order by verified_at desc`;
  return rows.map((r) => ({ address: r.address, verifiedAt: r.verified_at }));
}

/** Whether CAPX may send to this address on this account's behalf. */
export async function isLinked(userId: string, address: string): Promise<boolean> {
  if (!dbConfigured || !isAddress(address)) return false;
  await migrate();
  const rows = await db()`
    select 1 from capx.wallet_links
     where user_id = ${userId}::uuid and lower(address) = ${normalise(address)}
       and verified_at is not null and revoked_at is null`;
  return rows.length > 0;
}

/** Unlinks an address. The customer's own decision, and immediate. */
export async function revokeLink(userId: string, address: string): Promise<void> {
  await migrate();
  await db()`
    update capx.wallet_links set revoked_at = now(), nonce = null
     where user_id = ${userId}::uuid and lower(address) = ${normalise(address)}`;
}
