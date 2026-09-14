import "server-only";
import { db, migrate } from "./db";

/**
 * What a custodian says it holds, and what CAPX has issued against it.
 *
 * The one number this file exists to produce is the backing ratio. Everything
 * else — the attestation list, the issuance log — is there so that number can
 * be explained rather than asserted.
 *
 * Two rules shape the reads below. An attestation that has expired backs
 * nothing: a statement from six months ago is not evidence the shares are
 * there today. And issuance is measured from the mint and burn log rather than
 * from a running total, so the figure cannot drift away from the events that
 * produced it.
 */

export type Attestation = {
  id: string;
  security: string;
  custodian: string;
  quantity: number;
  locked: number;
  doc_ref: string | null;
  issued_at: string;
  expires_at: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  approved_by: string | null;
  signature: string | null;
};

export type Backing = {
  security: string;
  custodian: string | null;
  /** Shares the custodian confirms holding. */
  underlying: number;
  /** Of those, the ones earmarked against tokens. */
  locked: number;
  /** Tokens outstanding, from the issuance log. */
  issued: number;
  /** locked ÷ issued, as a percentage. Infinite coverage reads as null. */
  ratioPct: number | null;
  /** How many more tokens may be issued before breaching the backing. */
  headroom: number;
  /** False when the attestation has expired or none is approved. */
  fresh: boolean;
  expiresAt: string | null;
  lastVerified: string | null;
};

/** The approved attestation currently in force, if any. */
export async function activeAttestation(security: string): Promise<Attestation | null> {
  await migrate();
  const rows = await db()<Attestation[]>`
    select id::text, security, custodian, quantity::float8 as quantity, locked::float8 as locked,
           doc_ref, issued_at, expires_at, status, approved_by, signature
      from capx.custody_attestations
     where security = ${security} and status = 'approved' and expires_at > now()
     order by issued_at desc
     limit 1`;
  return rows[0] ?? null;
}

/** Net tokens outstanding, summed from the events that created them. */
export async function issuedQuantity(security: string): Promise<number> {
  await migrate();
  const rows = await db()<{ total: string | null }[]>`
    select coalesce(sum(case when kind = 'mint' then quantity else -quantity end), 0)::text as total
      from capx.issuance_events
     where security = ${security}`;
  return Number(rows[0]?.total ?? 0);
}

export async function backing(security: string): Promise<Backing> {
  const [att, issued] = await Promise.all([
    activeAttestation(security),
    issuedQuantity(security),
  ]);

  const locked = att?.locked ?? 0;
  return {
    security,
    custodian: att?.custodian ?? null,
    underlying: att?.quantity ?? 0,
    locked,
    issued,
    // Nothing issued is not 0% backed, it is a ratio with no denominator —
    // reporting 0% would read as a breach when none exists.
    ratioPct: issued > 0 ? (locked / issued) * 100 : null,
    headroom: Math.max(0, locked - issued),
    fresh: !!att,
    expiresAt: att?.expires_at ?? null,
    lastVerified: att?.issued_at ?? null,
  };
}

/**
 * Whether more tokens may be issued, and why not when they may not.
 *
 * Returns a reason rather than a boolean so the refusal can be shown to the
 * operator who has to act on it — "no approved attestation" and "would exceed
 * custody by 5" need different responses.
 */
export async function canIssue(security: string, quantity: number): Promise<{ ok: boolean; reason?: string; backing: Backing }> {
  const b = await backing(security);
  if (!(quantity > 0)) return { ok: false, reason: "Quantity must be greater than zero.", backing: b };
  if (!b.fresh) {
    return {
      ok: false,
      reason: "No approved custody attestation is in force — it is missing, unapproved or expired.",
      backing: b,
    };
  }
  if (quantity > b.headroom) {
    return {
      ok: false,
      reason: `Only ${b.headroom} more may be issued: ${b.locked} shares are locked and ${b.issued} tokens already exist.`,
      backing: b,
    };
  }
  return { ok: true, backing: b };
}

/**
 * Records a mint or a burn.
 *
 * Issuance is checked here rather than only at the call site, so no future
 * caller can create tokens beyond custody by forgetting to ask first (Rule 1).
 */
export async function recordIssuance(input: {
  security: string;
  kind: "mint" | "burn";
  quantity: number;
  attestationId?: string | null;
  txHash?: string | null;
  actor?: string | null;
}) {
  if (input.kind === "mint") {
    const check = await canIssue(input.security, input.quantity);
    if (!check.ok) throw new Error(check.reason ?? "Issuance refused.");
  } else {
    const issued = await issuedQuantity(input.security);
    if (input.quantity > issued) {
      throw new Error(`Cannot burn ${input.quantity}: only ${issued} are outstanding.`);
    }
  }

  await migrate();
  const rows = await db()<{ id: string }[]>`
    insert into capx.issuance_events (security, kind, quantity, attestation_id, tx_hash, actor)
    values (${input.security}, ${input.kind}, ${input.quantity},
            ${input.attestationId ?? null}, ${input.txHash ?? null}, ${input.actor ?? null})
    returning id::text`;
  return rows[0].id;
}
