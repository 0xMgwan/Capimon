import "server-only";
import { db, dbConfigured, migrate } from "./db";

/**
 * Locking shares at the CSD, and proving it before anything is minted.
 *
 * This is what the custody attestation has been standing in for. FIMCO files
 * a statement saying a quantity is held and locked, a person approves it, and
 * minting is capped at the figure on the form. That was the best available
 * answer while the exchange had no API: the lock was real, but CAPX's
 * evidence of it was a document.
 *
 * A pledge instruction is the same intent made enforceable. It locks a
 * quantity in an investor's CSD account in CAPX's favour, and the holdings
 * enquiry reports the result as `pledgedBalance` — a figure neither CAPX nor
 * the broker writes. So the attestation stops being the authority and becomes
 * the paper trail; the CSD becomes the authority.
 *
 * ## Why a row is written before the instruction is sent
 *
 * The exchange's guide is explicit that a hold or release must not be retried
 * automatically after a timeout, and there is no lookup by our own reference
 * to ask with afterwards. A timeout therefore leaves exactly one way to find
 * out what happened: read the holdings. That only works if something recorded
 * that the attempt was made, so the row goes in first and is updated with
 * whatever comes back. A crash between the two leaves a `sending` row, which
 * is the correct state to find — it says an instruction may be in flight and
 * a person should look, rather than saying nothing at all.
 *
 * ## Two confirmations, and why both
 *
 * `upstream.accepted` is the CSD's own answer, which the exchange's guide
 * calls final. Their email says validation continues inside the CSD after
 * acceptance. Both are recorded, and the status only reaches `confirmed` when
 * the holdings have actually moved. Believing the weaker assurance costs a
 * poll; believing the stronger one, if the email is the accurate half, costs
 * tokens minted against shares nothing locked.
 */

/** The account whose holdings back CAPX's tokens, and the pledgor's broker. */
const INVESTOR_ACCOUNT = (process.env.DSE_CSD_INVESTOR_ACCOUNT ?? "").trim();
const BROKER_CODE = (process.env.DSE_CSD_BROKER_CODE ?? "").trim();

export const pledgingConfigured = INVESTOR_ACCOUNT.length > 0 && BROKER_CODE.length > 0;

export type PledgeAction = "hold" | "release";

export type PledgeStatus =
  /** Written, not yet sent. A row left here needs a person. */
  | "sending"
  /** The exchange took it. Not yet evidence of a lock. */
  | "accepted"
  /** The holdings moved by at least the quantity asked for. */
  | "confirmed"
  /** Accepted, and the holdings have not moved yet. Wait, do not resend. */
  | "unconfirmed"
  /** Refused outright, or never reached them. */
  | "failed";

/**
 * What a completed attempt amounts to.
 *
 * Pure, because the ordering of these three checks is the judgement and the
 * calls around it are not. `accepted === false` is a refusal and ends it;
 * `null` means the field was absent, which the exchange's notes say to treat
 * as unconfirmed rather than as a yes.
 */
export function outcomeOf(args: {
  upstreamAccepted: boolean | null;
  movedBy: number;
  quantity: number;
}): { status: PledgeStatus; reason: string | null } {
  if (args.upstreamAccepted === false) {
    return { status: "failed", reason: "the CSD did not accept the instruction" };
  }
  if (args.movedBy >= args.quantity) {
    return { status: "confirmed", reason: null };
  }
  return {
    status: "unconfirmed",
    reason: args.upstreamAccepted === null
      ? "the CSD did not say whether it accepted, and the holdings have not moved"
      : `the CSD accepted it and the holdings have moved by ${args.movedBy} of ${args.quantity}`,
  };
}

export type PledgeRow = {
  id: string;
  security: string;
  action: PledgeAction;
  quantity: number;
  status: PledgeStatus;
  requestId: string | null;
  upstreamAccepted: boolean | null;
  wasPledged: number | null;
  reason: string | null;
  createdAt: string;
  confirmedAt: string | null;
};

/**
 * Places a hold or a release, then checks whether the holdings agree.
 *
 * The quantity is whole shares; `pledgeQuantityFor` is what rounds a
 * fractional book up to one. The `wasPledged` reading is taken *before* the
 * instruction, because the confirmation is a comparison and an absolute
 * threshold would read somebody else's lock as ours.
 */
export async function instruct(args: {
  security: string;
  action: PledgeAction;
  quantity: number;
  actor?: string;
}): Promise<PledgeRow> {
  if (!dbConfigured) throw new Error("No database is configured.");
  if (!pledgingConfigured) {
    throw new Error(
      "No CSD investor account or broker code is configured, so there is nothing to pledge against.",
    );
  }

  const S = args.security.toUpperCase();
  await migrate();
  const sql = db();

  const [sec] = await sql<{ isin: string | null; name: string }[]>`
    select isin, name from capx.securities where symbol = ${S}`;
  if (!sec?.isin) {
    throw new Error(
      `No ISIN is recorded for ${S}. The CSD identifies a security by ISIN and will not take a ticker.`,
    );
  }

  const {
    cdsAccount, holdingOf, pledge, releasePledge,
  } = await import("./dseCustody");
  const account = cdsAccount(INVESTOR_ACCOUNT);

  /* What is locked before we ask for anything. */
  const before = await holdingOf(account, S).catch(() => null);
  const wasPledged = before?.pledgedBalance ?? 0;

  /* The row goes in before the instruction leaves, so a timeout leaves
     evidence rather than silence. */
  const [row] = await sql<{ id: string }[]>`
    insert into capx.pledge_instructions
      (security, action, quantity, isin, investor_account, broker_code,
       was_pledged, status, actor)
    values (${S}, ${args.action}, ${args.quantity}, ${sec.isin},
            ${INVESTOR_ACCOUNT}, ${BROKER_CODE}, ${wasPledged}, 'sending',
            ${args.actor ?? null})
    returning id::text`;
  const id = row.id;

  const req = {
    securityIsin: sec.isin,
    securityDesc: sec.name,
    quantity: args.quantity,
    investorAccount: INVESTOR_ACCOUNT,
    brokerCode: BROKER_CODE,
  };

  let accepted;
  try {
    accepted = args.action === "hold" ? await pledge(req) : await releasePledge(req);
  } catch (e) {
    const why = e instanceof Error ? e.message : "the instruction failed";
    await sql`
      update capx.pledge_instructions set status = 'failed', reason = ${why}
       where id = ${id}::uuid`;
    /*
     * A failure here may still have been taken. Their guide forbids an
     * automatic retry, so the row is marked and a person decides; the
     * holdings are the only thing that can settle it.
     */
    return readOne(id);
  }

  await sql`
    update capx.pledge_instructions
       set status = 'accepted', request_id = ${accepted.requestId},
           upstream_accepted = ${accepted.upstreamAccepted},
           trade_date = ${accepted.tradeDate}, settlement_date = ${accepted.settlementDate}
     where id = ${id}::uuid`;

  await confirm(id);
  return readOne(id);
}

/**
 * Re-reads the holdings and settles what an accepted instruction amounted to.
 *
 * Separate from `instruct` and safe to call again, because the CSD may still
 * be processing when the instruction returns. Nothing here ever resends.
 */
export async function confirm(id: string): Promise<PledgeRow> {
  await migrate();
  const sql = db();

  const [row] = await sql<{
    security: string; action: PledgeAction; quantity: string;
    was_pledged: string | null; upstream_accepted: boolean | null;
    investor_account: string;
  }[]>`
    select security, action, quantity::float8::text, was_pledged::float8::text,
           upstream_accepted, investor_account
      from capx.pledge_instructions where id = ${id}::uuid`;
  if (!row) throw new Error("No such instruction.");

  const { cdsAccount, holdingOf } = await import("./dseCustody");
  const now = await holdingOf(cdsAccount(row.investor_account), row.security).catch(() => null);
  if (!now) return readOne(id);

  const was = Number(row.was_pledged ?? 0);
  const quantity = Number(row.quantity);
  /* A hold should raise the pledged balance; a release should lower it. The
     direction is read from the action rather than from the sign of the
     difference, so a move the wrong way cannot be counted as progress. */
  const movedBy = row.action === "hold"
    ? now.pledgedBalance - was
    : was - now.pledgedBalance;

  const { status, reason } = outcomeOf({
    upstreamAccepted: row.upstream_accepted, movedBy, quantity,
  });

  await sql`
    update capx.pledge_instructions
       set status = ${status}, reason = ${reason},
           confirmed_at = ${status === "confirmed" ? sql`now()` : null}
     where id = ${id}::uuid`;

  return readOne(id);
}

async function readOne(id: string): Promise<PledgeRow> {
  const [r] = await db()<{
    id: string; security: string; action: PledgeAction; quantity: string;
    status: PledgeStatus; request_id: string | null; upstream_accepted: boolean | null;
    was_pledged: string | null; reason: string | null;
    created_at: string; confirmed_at: string | null;
  }[]>`
    select id::text, security, action, quantity::float8::text, status, request_id,
           upstream_accepted, was_pledged::float8::text, reason,
           created_at::text, confirmed_at::text
      from capx.pledge_instructions where id = ${id}::uuid`;
  return {
    id: r.id, security: r.security, action: r.action,
    quantity: Number(r.quantity), status: r.status,
    requestId: r.request_id, upstreamAccepted: r.upstream_accepted,
    wasPledged: r.was_pledged === null ? null : Number(r.was_pledged),
    reason: r.reason, createdAt: r.created_at, confirmedAt: r.confirmed_at,
  };
}

/** The instructions, newest first, for the desk. */
export async function recentPledges(limit = 50): Promise<PledgeRow[]> {
  if (!dbConfigured) return [];
  await migrate();
  const rows = await db()<{ id: string }[]>`
    select id::text from capx.pledge_instructions
     order by created_at desc limit ${limit}`;
  return Promise.all(rows.map((r) => readOne(r.id)));
}

/**
 * What the CSD says is locked for one security, right now.
 *
 * The figure `custody.ts` folds in beside the filed attestation and the
 * on-chain registry. Null when it cannot be read, which must never be taken
 * as zero: an unreachable exchange is not evidence that a lock was released,
 * and treating it as such would strand every token behind an outage.
 */
export async function csdLocked(security: string): Promise<number | null> {
  if (!pledgingConfigured) return null;
  try {
    const { cdsAccount, holdingOf } = await import("./dseCustody");
    const h = await holdingOf(cdsAccount(INVESTOR_ACCOUNT), security.toUpperCase());
    return h ? h.pledgedBalance : 0;
  } catch {
    return null;
  }
}
