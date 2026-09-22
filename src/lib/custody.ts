import "server-only";
import { db, migrate } from "./db";
import { onchainSupply, onchainCustody } from "./securities";

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
  /** Tokens outstanding. The chain's figure once the security has a token. */
  issued: number;
  /** Of those, the ones customers have a claim on. */
  clientHeld: number;
  /** Issued but not yet sold to anyone — what is left to sell. */
  unallocated: number;
  /** What the issuance log says was minted. Equal to `issued` when all is well. */
  recorded: number;
  /** issued − recorded. Non-zero means the log and the chain disagree. */
  drift: number;
  /** Which of the two the ceiling is computed from — always the larger. */
  source: "chain" | "ledger";
  /** locked ÷ issued, as a percentage. Infinite coverage reads as null. */
  ratioPct: number | null;
  /** How many more tokens may be issued before breaching the backing. */
  headroom: number;
  /** False when the attestation has expired or none is approved. */
  fresh: boolean;
  /** Which record the custody figures came from. */
  custodySource: "chain" | "filed" | "none";
  /** Set when the filed copy and the published registry entry disagree. */
  custodyMismatch: string | null;
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

/** Net tokens the issuance log claims, summed from the events themselves. */
export async function recordedQuantity(security: string): Promise<number> {
  await migrate();
  const rows = await db()<{ total: string | null }[]>`
    select coalesce(sum(case when kind = 'mint' then quantity else -quantity end), 0)::text as total
      from capx.issuance_events
     where security = ${security}`;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Tokens outstanding.
 *
 * The chain's figure when the security has a token, because that is what
 * actually exists. Before tokenisation there is nothing to read and the log is
 * all there is, so it stands in — flagged as such rather than passed off as a
 * measurement.
 */
export async function issuedQuantity(security: string): Promise<number> {
  const [chain, recorded] = await Promise.all([
    onchainSupply(security).catch(() => null),
    recordedQuantity(security),
  ]);
  return chain ? chain.quantity : recorded;
}

export async function backing(security: string): Promise<Backing> {
  /*
   * A token CAPX did not issue is backed by what CAPX holds.
   *
   * Measuring an external listing the usual way compared the token's whole
   * supply — every subscriber's DPRI, not ours — against our issuance log,
   * which read as a huge unrecorded mint and offered to burn other people's
   * tokens. There is no attestation and no issuance here: the treasury's
   * balance is the backing and customers' claims are what it must cover.
   */
  const ext = await externalBacking(security);
  if (ext) return ext;

  const [att, onchain, chain, recorded, clientHeld] = await Promise.all([
    activeAttestation(security),
    onchainCustody(security).catch(() => null),
    onchainSupply(security).catch(() => null),
    recordedQuantity(security),
    /*
     * What customers between them are owed.
     *
     * Reported because its absence was the one thing making the public page and
     * the trading page look like they disagreed: buying does not mint and
     * selling does not burn, so tokens outstanding stays flat at a hundred
     * while what is left to sell falls. Both figures were right and neither
     * explained the other.
     */
    import("./ledger").then((m) => m.totalLiabilities())
      .then((ls) => ls.find((l) => l.asset === security)?.amount ?? 0)
      .catch(() => 0),
  ]);

  /*
   * The published statement wins over the filed one.
   *
   * The registry entry is the claim CAPX has actually made where anyone can
   * check it; the database row is the desk's workflow, and a row marked
   * approved is a statement of intent until it reaches the chain. Backing a
   * token against intent is how a system ends up over-issued with every
   * internal record looking correct.
   *
   * When both exist and disagree, the smaller quantity is used and the
   * disagreement is reported. Neither copy is assumed right, and the direction
   * that cannot over-issue is the one to be wrong in.
   */
  const usable = onchain?.fresh ? onchain : null;
  const custodySource: "chain" | "filed" | "none" = usable ? "chain" : att ? "filed" : "none";
  let custodyMismatch: string | null = null;
  if (usable && att && (usable.locked !== att.locked || usable.quantity !== att.quantity)) {
    custodyMismatch =
      `The filed attestation says ${att.quantity} held / ${att.locked} locked, ` +
      `the registry says ${usable.quantity} / ${usable.locked}.`;
  }

  const issued = chain ? chain.quantity : recorded;
  /*
   * The ceiling is computed from whichever figure is larger.
   *
   * The two can disagree in both directions and both are dangerous if trusted
   * alone: a mint that happened but was never written down would leave the log
   * understating supply, and a mint written down but never executed would leave
   * the chain understating it. Taking the larger means neither mistake invents
   * headroom, and the drift stays visible instead of being averaged away.
   */
  const committed = Math.max(issued, recorded);
  const locked = usable
    ? (att ? Math.min(usable.locked, att.locked) : usable.locked)
    : att?.locked ?? 0;
  const underlying = usable
    ? (att ? Math.min(usable.quantity, att.quantity) : usable.quantity)
    : att?.quantity ?? 0;
  return {
    security,
    custodian: usable?.custodian ?? att?.custodian ?? null,
    underlying,
    locked,
    issued,
    clientHeld,
    unallocated: Math.max(0, issued - clientHeld),
    recorded,
    drift: issued - recorded,
    source: chain ? "chain" : "ledger",
    // Nothing issued is not 0% backed, it is a ratio with no denominator —
    // reporting 0% would read as a breach when none exists.
    ratioPct: committed > 0 ? (locked / committed) * 100 : null,
    headroom: Math.max(0, locked - committed),
    // Freshness is the registry's to decide once it has a statement: an entry
    // that has expired on-chain backs nothing, whatever the desk still shows.
    fresh: usable ? true : !!att,
    custodySource,
    custodyMismatch,
    expiresAt: usable?.expiresAt ?? att?.expires_at ?? null,
    lastVerified: usable?.issuedAt ?? att?.issued_at ?? null,
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
      reason: "No custody attestation is in force — it is missing, unapproved, or expired on-chain.",
      backing: b,
    };
  }
  if (quantity > b.headroom) {
    return {
      ok: false,
      reason: `Only ${b.headroom} more may be issued: ${b.locked} shares are locked and ${Math.max(b.issued, b.recorded)} tokens already exist.`,
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
    // Burning is bounded by what actually exists on the chain, not by what the
    // log believes — the smaller of the two, so an over-count in the log cannot
    // authorise burning tokens that are not there.
    const [chain, recorded] = await Promise.all([
      onchainSupply(input.security).catch(() => null),
      recordedQuantity(input.security),
    ]);
    const outstanding = chain ? Math.min(chain.quantity, recorded) : recorded;
    if (input.quantity > outstanding) {
      throw new Error(`Cannot burn ${input.quantity}: only ${outstanding} are outstanding.`);
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

/**
 * Makes the issuance log agree with the chain.
 *
 * Needed because the two legitimately diverge: minting uses the issuing key and
 * happens outside this app, so a mint is real before anything writes it down.
 * The ordinary mint path cannot close that gap — it asks `canIssue` first, and
 * the tokens it is trying to record are already counted against the ceiling, so
 * recording a mint that has happened is refused for having no headroom.
 *
 * This is not a way around the ceiling. The quantity is read from the chain and
 * never taken from the caller, so the most it can do is write down tokens that
 * demonstrably exist. It cannot create room to issue and it cannot invent a
 * number.
 *
 * Only the direction where the chain leads is repaired. A log claiming more
 * than the chain holds means a mint was recorded and never executed, and which
 * of those two is wrong is a question for a person, not a default.
 */
export async function reconcileIssuance(
  security: string,
  input: { txHash?: string | null; actor?: string | null } = {},
): Promise<{ recorded: number; issued: number; added: number }> {
  const chain = await onchainSupply(security);
  if (!chain) {
    throw new Error(`${security} has no token address registered, so there is no chain figure to reconcile against.`);
  }
  const recorded = await recordedQuantity(security);
  const drift = chain.quantity - recorded;

  if (drift === 0) return { recorded, issued: chain.quantity, added: 0 };
  if (drift < 0) {
    throw new Error(
      `The log records ${recorded} but only ${chain.quantity} exist on-chain. ` +
      `That is a mint written down and never executed — it needs a decision, not a reconciliation.`,
    );
  }

  await migrate();
  await db()`
    insert into capx.issuance_events (security, kind, quantity, tx_hash, actor)
    values (${security}, 'mint', ${drift}, ${input.txHash ?? null},
            ${input.actor ? `${input.actor} (reconciled to chain)` : "reconciled to chain"})`;

  return { recorded, issued: chain.quantity, added: drift };
}


/**
 * Writes down a burn the chain has already carried out.
 *
 * The mirror of reconcileIssuance: the quantity is the gap between what the
 * log records and what exists on-chain, never a number from a form, so the
 * log can only ever be brought into line with the chain.
 */
export async function recordBurnFromChain(
  security: string,
  input: { txHash?: string | null; actor?: string | null } = {},
): Promise<{ recorded: number; issued: number; burned: number }> {
  const chain = await onchainSupply(security);
  if (!chain) throw new Error(`${security} has no token address registered.`);
  const recorded = await recordedQuantity(security);
  const burned = recorded - chain.quantity;
  if (burned <= 0) return { recorded, issued: chain.quantity, burned: 0 };
  await migrate();
  await db()`
    insert into capx.issuance_events (security, kind, quantity, tx_hash, actor)
    values (${security}, 'burn', ${burned}, ${input.txHash ?? null}, ${input.actor ?? "burn"})`;
  return { recorded, issued: chain.quantity, burned };
}


/**
 * Backing for a listing CAPX bought rather than minted, or null when the
 * security is one CAPX tokenised itself.
 */
async function externalBacking(security: string): Promise<Backing | null> {
  const { dseSecurity } = await import("./dseSecurities");
  const sec = await dseSecurity(security).catch(() => null);
  if (!sec || sec.kind !== "external") return null;

  const [{ treasuryHoldings }, { totalLiabilities }] = await Promise.all([
    import("./treasury"), import("./ledger"),
  ]);
  const [t, ls] = await Promise.all([
    treasuryHoldings().catch(() => null),
    totalLiabilities().catch(() => [] as { asset: string; amount: number }[]),
  ]);
  const held = t?.holdings.find((h) => h.asset === sec.symbol)?.qty ?? 0;
  const clientHeld = ls.find((l) => l.asset === sec.symbol)?.amount ?? 0;

  return {
    security: sec.symbol,
    custodian: sec.issuer ?? "External issuer",
    underlying: held,
    locked: held,
    // What customers are owed is the only "issued" figure that means anything
    // here; the token's supply belongs to its issuer and everyone else holding it.
    issued: clientHeld,
    clientHeld,
    unallocated: Math.max(0, held - clientHeld),
    recorded: clientHeld,
    drift: 0,
    source: "chain",
    ratioPct: clientHeld > 0 ? (held / clientHeld) * 100 : null,
    headroom: Math.max(0, held - clientHeld),
    fresh: held > 0,
    custodySource: "chain",
    custodyMismatch: null,
    expiresAt: null,
    lastVerified: new Date().toISOString(),
  };
}
