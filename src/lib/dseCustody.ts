import "server-only";

/**
 * The DSE's CSD stakeholder API: reading custody and pledging shares.
 *
 * Custody has until now been a number a person typed. `custody.ts` reads an
 * approved attestation from `capx.custody_attestations`, compares it against
 * the on-chain registry and uses the smaller of the two — a good defence
 * against one of them being wrong, and no defence at all against both being
 * stale. This is the live source that replaces it: the CSD's own record of
 * what is held and what is locked.
 *
 * ## The rule this file exists to enforce
 *
 * A `2000` from a pledge instruction is not a lock.
 *
 * The exchange were explicit about it: 2000 means the CSD has received the
 * instruction and queued it, and the validation that matters — sufficient
 * quantity, account validity, pledgee details — happens later, during
 * processing. How a processing rejection is communicated is still to be
 * confirmed.
 *
 * So minting against a 2000 would issue tokens against shares that were never
 * pledged, and every solvency check downstream would pass, because our own
 * records would say the lock succeeded. That is the worst shape a custody bug
 * can take: silent, and self-confirming. `confirmPledge` below is the only
 * thing in this file that may be read as evidence of a lock, and it reads the
 * CSD's `pledgedBalance` rather than anything the instruction returned.
 *
 * ## What is deliberately absent
 *
 * Releasing a pledge. The exchange's answers covered the pledge path and said
 * nothing about the reverse, and release is the half that matters for
 * redemptions — burn the token, release the lock, sell on the exchange. It is
 * left out rather than guessed at: an invented endpoint that silently does
 * nothing is worse than an absent one, which at least refuses.
 */

const BASE_URL = process.env.DSE_CSD_BASE_URL ?? "";
const CLIENT_ID = process.env.DSE_CSD_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.DSE_CSD_CLIENT_SECRET ?? "";

/** Our own BPID: the party receiving a pledge. */
export const DSE_BPID = process.env.DSE_CSD_BPID ?? "";

export const dseCustodyConfigured =
  BASE_URL.length > 0 && CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;

export class DseCustodyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    /**
     * What a caller may do about it.
     *
     * "verify" never means retry. It means the instruction may or may not
     * have been taken, and the only way to find out is to read the holdings —
     * which is the whole of the idempotency story here, since the CSD offers
     * no key and no lookup by our own reference.
     */
    readonly retry: "no" | "backoff" | "verify" = "no",
  ) {
    super(message);
    this.name = "DseCustodyError";
  }
}

/* ------------------------------------------------------------ accounts -- */

/**
 * Two account numbers that the API's own field names get backwards.
 *
 * The exchange flagged this themselves. On a pledge instruction `csdAccount`
 * is the *broker's* safe-custody account (B21/C) and `brokerCode` is the
 * *investor's* CDS account — each the opposite of what it reads like. And the
 * investor's CDS account is `cdsAccount` on the holdings enquiry but
 * `brokerCode` on the pledge: one value, two names, two endpoints.
 *
 * Branding them means the compiler refuses the swap. Passing two bare strings
 * in the wrong order type-checks perfectly and pledges against the wrong
 * account, which is not a mistake to find in production.
 */
export type SafeCustodyAccount = string & { readonly __brand: "SafeCustodyAccount" };
export type CdsAccount = string & { readonly __brand: "CdsAccount" };

/** A broker's safe-custody account, shaped like "B21/C". */
export function safeCustodyAccount(raw: string): SafeCustodyAccount {
  const v = raw.trim().toUpperCase();
  if (!/^B\d{1,6}\/[A-Z]$/.test(v)) {
    throw new DseCustodyError(
      "bad_account",
      `"${raw}" is not a safe-custody account. Expected a form like B21/C — ` +
      `an investor's CDS account goes in a different field.`,
      400,
    );
  }
  return v as SafeCustodyAccount;
}

/**
 * An investor's CDS account.
 *
 * Deliberately loose on format and strict on the one thing that distinguishes
 * it: it must not look like a safe-custody account. The exact CDS numbering
 * is not documented to us yet, so refusing everything that does not match a
 * guessed pattern would reject valid accounts. Refusing the one pattern we
 * know belongs to the other field catches the mistake this type exists for.
 */
export function cdsAccount(raw: string): CdsAccount {
  const v = raw.trim().toUpperCase();
  if (!v) throw new DseCustodyError("bad_account", "A CDS account is required.", 400);
  if (/^B\d{1,6}\/[A-Z]$/.test(v)) {
    throw new DseCustodyError(
      "bad_account",
      `"${raw}" is a broker safe-custody account, not an investor CDS account. ` +
      `These two are swapped relative to the API's field names — check the mapping.`,
      400,
    );
  }
  return v as CdsAccount;
}

/* --------------------------------------------------------------- auth -- */

/**
 * The token, cached until shortly before it expires.
 *
 * UAT issues one good for about five and a half days and returns a
 * `refresh_token` with it. The lifetime is read from `expires_in` every time
 * rather than assumed: production will differ, and a hardcoded 471,599 would
 * be a self-inflicted outage the first time it does.
 */
type Token = { value: string; refresh: string | null; expiresAt: number };
let token: Token | null = null;
let inFlight: Promise<Token> | null = null;

/** Renew this far before expiry, so a long request cannot straddle it. */
const RENEW_MARGIN_MS = 10 * 60_000;

async function requestToken(): Promise<Token> {
  const res = await fetch(`${BASE_URL}/stakeholder/api/v1/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* reported below */ }

  if (!res.ok || typeof body.access_token !== "string") {
    throw new DseCustodyError(
      "auth_failed",
      `The CSD refused the credentials (${res.status}).`,
      res.status || 502,
    );
  }

  /* An absent or unparseable expires_in is treated as one hour rather than
     forever: a token believed valid past its life fails every call until
     something clears the cache. */
  const ttlS = Number(body.expires_in);
  const lifeMs = Number.isFinite(ttlS) && ttlS > 0 ? ttlS * 1000 : 3_600_000;

  return {
    value: body.access_token,
    refresh: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: Date.now() + lifeMs,
  };
}

/**
 * One token fetch at a time.
 *
 * Several requests arriving on a cold cache would each authenticate, and if
 * the CSD rotates the token on issue — which we have asked about and do not
 * yet know — the later ones would invalidate the earlier, so a request would
 * fail holding a token that was valid when it was handed out.
 */
async function authorization(): Promise<string> {
  if (!dseCustodyConfigured) {
    throw new DseCustodyError("not_configured", "The DSE CSD API is not configured.", 503);
  }
  if (token && Date.now() < token.expiresAt - RENEW_MARGIN_MS) return token.value;
  if (!inFlight) {
    inFlight = requestToken().finally(() => { inFlight = null; });
  }
  token = await inFlight;
  return token.value;
}

/** Drops the cached token, so the next call authenticates afresh. */
export function forgetToken(): void {
  token = null;
}

/* --------------------------------------------------------------- call -- */

/**
 * The CSD's own result codes, which ride inside a 200.
 *
 * A 401 arrives with an empty body and no code at all, so the transport
 * status and the result code both have to be read; neither alone is the
 * answer.
 */
const RESULT: Record<string, { code: string; message: string; retry: "no" | "backoff" | "verify" }> = {
  "2000": { code: "ok", message: "Accepted.", retry: "no" },
  "4000": { code: "validation", message: "A field is missing or invalid.", retry: "no" },
  "4001": { code: "unauthenticated", message: "Authentication required.", retry: "no" },
  "5000": { code: "csd_error", message: "The CSD reported a server error.", retry: "verify" },
};

type Envelope<T> = { resultCode?: string | number; message?: string; data?: T } & Record<string, unknown>;

async function call<T>(path: string, body: unknown, opts: { retried?: boolean } = {}): Promise<T> {
  const bearer = await authorization();

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    /*
     * A timeout is the dangerous case and is marked as such.
     *
     * The instruction may well have been taken; we simply never saw the
     * answer, and with no idempotency key and no lookup by our own reference
     * there is nothing to ask. "verify" tells the caller to read the holdings
     * — and never to resend, which is what would pledge twice.
     */
    throw new DseCustodyError(
      "unreachable",
      e instanceof Error && e.name === "TimeoutError"
        ? "The CSD did not answer in time. The instruction may still have been taken."
        : "The CSD could not be reached.",
      504,
      "verify",
    );
  }

  const text = await res.text();

  /* 401 with an empty body is their way of saying the token is no longer
     accepted. Worth one fresh token and one retry; twice means it is not the
     token. */
  if (res.status === 401) {
    forgetToken();
    if (!opts.retried) return call<T>(path, body, { retried: true });
    throw new DseCustodyError("unauthenticated", "The CSD rejected the token twice.", 401);
  }

  let parsed: Envelope<T> = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* handled below */ }

  if (!res.ok) {
    throw new DseCustodyError(
      "http_error",
      `The CSD returned ${res.status}.`,
      res.status,
      res.status >= 500 ? "verify" : "no",
    );
  }

  const result = String(parsed.resultCode ?? "");
  const known = RESULT[result];
  if (result !== "2000") {
    throw new DseCustodyError(
      known?.code ?? "unknown_result",
      /* Their message where there is one: the full code list is still to
         come, so an unrecognised code must carry its own number through
         rather than be flattened to "failed". */
      String(parsed.message ?? known?.message ?? `The CSD returned result code ${result || "none"}.`),
      200,
      known?.retry ?? "verify",
    );
  }

  return (parsed.data ?? (parsed as unknown)) as T;
}

/* ----------------------------------------------------------- holdings -- */

export type SecurityHolding = {
  symbol: string;
  totalBalance: number;
  /** Sellable: not pledged, not reserved, not already committed to a trade. */
  freeBalance: number;
  /** The figure that backs issued tokens, and the only evidence of a lock. */
  pledgedBalance: number;
  reservedBalance: number;
  pendingSale: number;
  pendingBuy: number;
};

type HoldingRow = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What the CSD says an account holds, by security.
 *
 * The authoritative answer to the question `custody.ts` currently answers
 * from a filed document. Note that it is keyed by an investor CDS account —
 * which account our own omnibus is readable under is a question outstanding
 * with the exchange, since the shares sit beneath a broker's safe-custody
 * account rather than an investor's.
 */
export async function holdingsByCds(account: CdsAccount): Promise<SecurityHolding[]> {
  const data = await call<HoldingRow[] | { holdings?: HoldingRow[] }>(
    "/stakeholder/api/v1/trading/holdings/by-cds",
    { cdsAccount: account },
  );

  const rows = Array.isArray(data) ? data : (data?.holdings ?? []);
  return rows.map((r) => ({
    symbol: String(r.security ?? r.securityCode ?? r.symbol ?? "").toUpperCase(),
    totalBalance: num(r.totalBalance),
    freeBalance: num(r.freeBalance),
    pledgedBalance: num(r.pledgedBalance),
    reservedBalance: num(r.reservedBalance),
    pendingSale: num(r.pendingSale),
    pendingBuy: num(r.pendingBuy),
  })).filter((h) => h.symbol);
}

/** One security out of an account's holdings, or null if it holds none. */
export async function holdingOf(
  account: CdsAccount, symbol: string,
): Promise<SecurityHolding | null> {
  const all = await holdingsByCds(account);
  const want = symbol.toUpperCase();
  return all.find((h) => h.symbol === want) ?? null;
}

/* ------------------------------------------------------------- pledge -- */

/**
 * The whole-share quantity to pledge against a fractional book.
 *
 * Customers hold fractional claims — a 10,000 TZS order for a 2,750 TZS share
 * is 3.63 of it — and the CSD accepts whole numbers only. So the lock has to
 * be rounded, and the direction is a solvency question rather than a
 * presentation one: rounding down leaves the book short by up to a share per
 * security, which is the difference between every position being backed and
 * not. The remainder is CAPX's own inventory, which the treasury already
 * carries elsewhere.
 */
export function pledgeQuantityFor(claimedShares: number): number {
  if (!(claimedShares > 0)) return 0;
  return Math.ceil(claimedShares - 1e-9);
}

export type PledgeRequest = {
  /** The security's DSE code. */
  symbol: string;
  /** Whole shares. A fraction is refused rather than silently truncated. */
  quantity: number;
  /** The broker's safe-custody account the shares sit under — their `csdAccount`. */
  custodyAccount: SafeCustodyAccount;
  /** The investor's CDS account — their `brokerCode`, confusingly. */
  investorAccount: CdsAccount;
};

export type PledgeAccepted = {
  /** The CSD's references. Retain both: there is no lookup by our own. */
  transactionId: string | null;
  processingId: string | null;
};

/**
 * Queues a pledge instruction. **This does not lock anything.**
 *
 * A 2000 means the CSD took the instruction. Whether it holds is decided
 * later, during processing, against checks this response has not run. Nothing
 * may be minted on the strength of what comes back from here — call
 * `confirmPledge` and mint on that.
 *
 * The caller is expected to have written its intent to durable storage before
 * calling, because a timeout leaves no way to ask what happened: see the
 * "verify" disposition on the error.
 */
export async function pledge(req: PledgeRequest): Promise<PledgeAccepted> {
  if (!DSE_BPID) {
    throw new DseCustodyError("not_configured", "No BPID is configured for CAPX.", 503);
  }
  if (!Number.isInteger(req.quantity) || req.quantity <= 0) {
    throw new DseCustodyError(
      "fractional_quantity",
      `The CSD accepts whole shares only; ${req.quantity} was given. ` +
      `Round with pledgeQuantityFor() so the lock covers the claims rather than trailing them.`,
      400,
    );
  }

  const data = await call<Record<string, unknown>>(
    "/stakeholder/api/v1/trading/pledge",
    {
      pledgeeBpid: DSE_BPID,
      /* Their names, not ours. The branded types above are what stop these
         two being handed over the wrong way round. */
      csdAccount: req.custodyAccount,
      brokerCode: req.investorAccount,
      security: req.symbol.toUpperCase(),
      quantity: req.quantity,
    },
  );

  const id = (k: string) => (typeof data[k] === "string" || typeof data[k] === "number"
    ? String(data[k]) : null);
  return {
    transactionId: id("transaction_id") ?? id("transactionId"),
    processingId: id("processing_id") ?? id("processingId"),
  };
}

export type PledgeConfirmation = {
  confirmed: boolean;
  /** What the CSD says is pledged now. */
  pledgedBalance: number;
  /** What it said before the instruction, for the comparison. */
  wasPledged: number;
  shortBy: number;
};

/**
 * The only evidence a pledge actually happened.
 *
 * Reads the CSD's holdings and asks whether `pledgedBalance` has risen by at
 * least what was asked for. Deliberately a comparison against a figure taken
 * *before* the instruction rather than a check that the total looks about
 * right: a security can be pledged for several reasons at once, and an
 * absolute threshold would read somebody else's lock as ours.
 *
 * An unconfirmed result is not a failure. The CSD processes asynchronously,
 * so "not yet" and "rejected" look identical here until they tell us how
 * rejections are communicated — which is why this reports what it saw and
 * refuses to guess which one it is. The caller waits, and escalates to a
 * person rather than resending.
 */
export async function confirmPledge(args: {
  investorAccount: CdsAccount;
  symbol: string;
  quantity: number;
  wasPledged: number;
}): Promise<PledgeConfirmation> {
  const holding = await holdingOf(args.investorAccount, args.symbol);
  const pledgedBalance = holding?.pledgedBalance ?? 0;
  const gained = pledgedBalance - args.wasPledged;
  return {
    confirmed: gained >= args.quantity,
    pledgedBalance,
    wasPledged: args.wasPledged,
    shortBy: Math.max(0, args.quantity - gained),
  };
}
