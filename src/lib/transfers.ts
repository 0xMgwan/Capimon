import "server-only";
import { randomUUID } from "crypto";
import { db, migrate } from "./db";
import { balanceOf, recordTrade, type TradeLeg } from "./ledger";

/**
 * Sending shares from one CAPX account to another.
 *
 * Nothing is bought or sold and nothing leaves custody: the same shares stay
 * with the same custodian and the claim on them moves. Which is why this is
 * safe to offer at all — solvency compares what clients are owed against what
 * is held, and a transfer changes neither total. It is written through
 * recordTrade so the two legs must net to zero in the security, and a
 * mistake that credited more than it debited cannot be committed.
 *
 * ## What the recipient inherits
 *
 * The sender's cost, not the day's price. A gift is not a disposal, so the
 * sender realises nothing and the recipient takes on the basis that came
 * with it — the alternative marks a gain into existence at the moment of
 * giving, and books it to somebody who never sold anything.
 *
 * The outgoing leg carries no price for exactly that reason: cost-basis
 * replay only books a realised gain when a disposal has one, so omitting it
 * removes the basis and books nothing. The incoming leg carries the sender's
 * average cost, so the recipient's P&L starts where the sender's left off.
 *
 * ## What it is not
 *
 * Not a payment rail. Both sides must be verified, because moving a security
 * between people is a thing done by identified parties, and a transfer is the
 * one way value reaches an account without passing a deposit check.
 */

export type TransferResult =
  | { ok: true; transferId: string; security: string; qty: number;
      from: string; to: string; inheritedCost: number | null; currency: string }
  | { ok: false; code: string; error: string; status: number };

const refuse = (code: string, error: string, status = 400): TransferResult =>
  ({ ok: false, code, error, status });

/**
 * The registry's spelling of a symbol the caller may have typed in any case.
 *
 * Matching is case-insensitive because nobody should have to know that a US
 * ticker is spelled NVDAc. The ledger is not: `balanceOf` compares `asset`
 * exactly, `positionCosts` keys a map by it, and every US position was
 * written as the registry's `symbol`. So the caller's word decides *which*
 * security, and the registry decides how it is spelled from then on.
 *
 * Returns null when nothing matches, which is the caller's "unknown security".
 */
export function canonicalSecurity(
  requested: string, listed: readonly string[],
): string | null {
  const key = requested.trim().toUpperCase();
  if (!key) return null;
  return listed.find((s) => s.toUpperCase() === key) ?? null;
}

export async function transferShares(input: {
  fromUserId: string;
  toUserId: string;
  security: string;
  qty: number;
  /** Shown to the recipient. Their own words, never ours. */
  note?: string;
  /** Idempotency: the same reference writes once. */
  ref?: string;
}): Promise<TransferResult> {
  const requested = input.security.trim();
  const qty = Number(input.qty);

  if (!requested) return refuse("security_required", "Name the security.");
  if (!Number.isFinite(qty) || qty <= 0) {
    return refuse("bad_quantity", "Quantity must be a positive number of shares.");
  }
  if (input.fromUserId === input.toUserId) {
    return refuse("same_account", "That is the same account.", 409);
  }

  await migrate();
  const sql = db();

  /* A security CAPX actually lists, on either board. */
  const [{ dseSecurities }, { ASSETS }] = await Promise.all([
    import("./dseSecurities"), import("./assets"),
  ]);
  const dseList = await dseSecurities().catch(() => []);
  const security = canonicalSecurity(
    requested, [...dseList.map((d) => d.symbol), ...ASSETS.map((a) => a.symbol)]);
  if (!security) {
    return refuse("unknown_security", `${requested} is not a security on CAPX.`, 404);
  }
  const dse = dseList.some((d) => d.symbol === security);

  const [from, to] = await sql<{ id: string; email: string; name: string | null;
                                 kyc_status: string }[]>`
    select id::text, email, name, kyc_status from capx.users
     where id = any(${[input.fromUserId, input.toUserId]}::uuid[])`
    .then((rows) => [
      rows.find((r) => r.id === input.fromUserId),
      rows.find((r) => r.id === input.toUserId),
    ]);

  if (!from) return refuse("unknown_sender", "That sender does not exist.", 404);
  if (!to) return refuse("unknown_recipient", "That recipient does not exist.", 404);

  /*
   * Both sides verified, and the recipient as much as the sender.
   *
   * A transfer is the only way value reaches an account without passing a
   * deposit or a trade, so an unverified recipient would be an unchecked way
   * in. Refusing is the honest answer — the shares stay where they are and
   * nothing is held in limbo waiting for somebody to finish signing up.
   */
  if (from.kyc_status !== "approved") {
    return refuse("sender_unverified",
      "The sender's account is not verified, so it cannot send securities.", 403);
  }
  if (to.kyc_status !== "approved") {
    return refuse("recipient_unverified",
      "That recipient is not verified yet, so they cannot receive securities. "
      + "They need to finish verification first.", 409);
  }

  const held = await balanceOf(from.id, security).catch(() => 0);
  if (qty > held + 1e-9) {
    return refuse("insufficient_shares",
      `The sender holds ${held.toLocaleString(undefined, { maximumFractionDigits: 8 })} `
      + `${security}.`, 409);
  }

  /* The cost that travels with the shares. */
  const { positionCosts } = await import("./pnl");
  const costs = await positionCosts(from.id).catch(() => new Map());
  const pos = costs.get(security);
  const inheritedCost = pos && pos.avgCost > 0 ? pos.avgCost : null;
  const currency = pos?.currency ?? (dse ? "TZS" : "USD");

  const ref = input.ref?.trim() || `transfer:${randomUUID()}`;
  const note = (input.note ?? "").toString().slice(0, 280) || null;

  const legs: TradeLeg[] = [
    {
      side: "customer", userId: from.id, kind: "transfer", asset: security, amount: -qty,
      ref: `${ref}:out`,
      /* No price: a gift is not a disposal, so no gain is realised here. */
      metadata: { transfer: ref, to: to.id, toEmail: to.email, note, currency },
    },
    {
      side: "customer", userId: to.id, kind: "transfer", asset: security, amount: qty,
      ref: `${ref}:in`,
      metadata: {
        transfer: ref, from: from.id, fromEmail: from.email, note, currency,
        /* The sender's average cost, so the recipient's basis continues it
           rather than starting from today's mark or from nothing. */
        ...(inheritedCost ? { price: inheritedCost } : {}),
      },
    },
  ];

  const wrote = await recordTrade(ref, legs);
  if (wrote.duplicate) {
    return { ok: true, transferId: ref, security, qty, from: from.id, to: to.id,
      inheritedCost, currency };
  }

  const { notify } = await import("./notify");
  const pretty = qty.toLocaleString(undefined, { maximumFractionDigits: 8 });
  await Promise.all([
    notify({
      userId: to.id, kind: "trade", ref: `${ref}:in`, asset: security,
      title: `Received ${pretty} ${security}`,
      body: `${from.name ?? from.email} sent you ${pretty} ${security}.`
        + (note ? ` "${note}"` : ""),
      url: "/portfolio",
    }).catch(() => {}),
    notify({
      userId: from.id, kind: "trade", ref: `${ref}:out`, asset: security,
      title: `Sent ${pretty} ${security}`,
      body: `To ${to.name ?? to.email}.`,
      url: "/activity",
    }).catch(() => {}),
  ]);

  return { ok: true, transferId: ref, security, qty, from: from.id, to: to.id,
    inheritedCost, currency };
}

/** Finds a CAPX account by email or handle, for naming a recipient. */
export async function findRecipient(who: string): Promise<{ id: string; email: string;
  name: string | null; username: string | null } | null> {
  const q = who.trim().toLowerCase();
  if (!q) return null;
  await migrate();
  const [row] = await db()<{ id: string; email: string; name: string | null;
                             username: string | null }[]>`
    select id::text, email, name, username from capx.users
     where lower(email) = ${q} or lower(username) = ${q.replace(/^@/, "")}
     limit 1`;
  return row ?? null;
}
