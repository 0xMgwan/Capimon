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

/**
 * Four credentials, not two.
 *
 * The exchange's environment carries `applicationId` and `accessSecret`
 * alongside `stakeholderUsername` and `stakeholderPassword` — an application
 * identity and a user identity, which is a different shape from the client
 * id and secret this file first assumed. The names below are theirs, so that
 * whoever fills them in is matching labels rather than translating.
 *
 * How the four are presented on the token request — which ride in the body,
 * which in headers, and at what path — is not something to infer from the
 * variable names a second time. `tokenRequest` below is the one piece still
 * waiting on their collection, and it says so rather than guessing.
 */
const BASE_URL = process.env.DSE_CSD_BASE_URL ?? "";
const APPLICATION_ID = process.env.DSE_CSD_APPLICATION_ID ?? "";
const ACCESS_SECRET = process.env.DSE_CSD_ACCESS_SECRET ?? "";
const STAKEHOLDER_USERNAME = process.env.DSE_CSD_STAKEHOLDER_USERNAME ?? "";
const STAKEHOLDER_PASSWORD = process.env.DSE_CSD_STAKEHOLDER_PASSWORD ?? "";

/** Our own BPID: the party receiving a pledge. */
export const DSE_BPID = process.env.DSE_CSD_BPID ?? "";

export const dseCustodyConfigured =
  BASE_URL.length > 0 && APPLICATION_ID.length > 0 && ACCESS_SECRET.length > 0
  && STAKEHOLDER_USERNAME.length > 0 && STAKEHOLDER_PASSWORD.length > 0;

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
 * The investor CDS account, for the holdings enquiry.
 *
 * Branded so it cannot be swapped with any other identifier at that call.
 * There is deliberately no matching type for the pledge instruction's
 * accounts: the exchange's guide and their email disagree about which of its
 * two account fields means what, and a type asserting one of them would
 * quietly make that choice permanent. Those stay named by meaning at the
 * call site until DSE settles it — see the note on PledgeRequest.
 */
export type CdsAccount = string & { readonly __brand: "CdsAccount" };

/* Loose on format and strict on the one thing that distinguishes it: the
   CDS numbering is not documented to us, so refusing everything that does
   not match a guessed pattern would reject valid accounts, while refusing
   the one shape known to belong elsewhere catches a swap. */
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

/**
 * The token endpoint, which is not under /stakeholder at all.
 *
 * OAuth 2.0 password grant: the application identity goes in an HTTP Basic
 * header and the stakeholder user's credentials go in the body. This was
 * inferred twice before the exchange's guide arrived and was wrong both
 * times — first as a client id and secret pair, then as all four in the
 * body — which is why it is now transcribed from their document rather than
 * reasoned about.
 */
const TOKEN_PATH = process.env.DSE_CSD_TOKEN_PATH
  ?? "/iam/api/v1/stakeholders/oauth/token";

/**
 * Finds the access token in a response whose field names we do not know.
 *
 * The exchange answered 200 to a body carrying its own four field names,
 * which settled that the credentials were always fine and that its token
 * endpoint is not the OAuth password grant its guide prints. What it did not
 * settle is what the token is called in the answer — and asking costs
 * another day.
 *
 * So it is searched for rather than guessed at, which is safe because of how
 * narrowly a bearer token is shaped: a long unbroken string under a key that
 * says token. Anything that does not look like one is not considered, and a
 * response with nothing matching still fails rather than sending a field
 * that happened to be long.
 *
 * Exported for the tests, because picking the wrong string here would send
 * an arbitrary value from the response as an Authorization header.
 */
export function findToken(body: unknown): { path: string; value: string } | null {
  const found: { path: string; value: string; score: number }[] = [];

  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 3 || node === null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const here = path ? `${path}.${k}` : k;
      if (typeof v === "string") {
        /* A bearer token is long and has no whitespace. A name, a date or a
           status message fails one of those. */
        if (v.length < 20 || /\s/.test(v)) continue;
        const key = k.toLowerCase();
        const score = key.includes("access") && key.includes("token") ? 4
          : key.includes("token") ? 3
          : key.includes("jwt") ? 2
          /* A JWT identifies itself: three base64 segments. Worth taking
             even under a key that says nothing, since nothing else in a
             response looks like one. */
          : /^[\w-]+\.[\w-]+\.[\w-]+$/.test(v) ? 1
          : 0;
        if (score > 0) found.push({ path: here, value: v, score });
      } else {
        walk(v, here, depth + 1);
      }
    }
  };

  walk(body, "", 0);
  if (!found.length) return null;
  /* Best score wins; shallower wins a tie, since a wrapper's own token sits
     above anything nested inside it. */
  found.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return { path: found[0].path, value: found[0].value };
}

/** The lifetime, under whichever of the usual names carries it. */
export function findExpiry(body: unknown): number | null {
  const names = ["expires_in", "expiresin", "expiry", "ttl", "validfor", "expiresat"];
  let out: number | null = null;
  const walk = (node: unknown, depth: number) => {
    if (depth > 3 || node === null || typeof node !== "object" || out !== null) return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (out !== null) return;
      if (names.includes(k.toLowerCase().replace(/[_-]/g, ""))) {
        const n = Number(v);
        /* Seconds, not a timestamp: anything past a year is an absolute date
           in disguise and would park the cache beyond any real lifetime. */
        if (Number.isFinite(n) && n > 0 && n < 400 * 86_400) { out = n; return; }
      } else if (typeof v === "object") {
        walk(v, depth + 1);
      }
    }
  };
  walk(body, 0);
  return out;
}

async function requestToken(): Promise<Token> {
  /* applicationId and accessSecret are the client id and secret, presented
     as Basic auth rather than in the body. */
  const basic = Buffer.from(`${APPLICATION_ID}:${ACCESS_SECRET}`, "utf8").toString("base64");

  const fields = {
    grant_type: "password",
    username: STAKEHOLDER_USERNAME,
    password: STAKEHOLDER_PASSWORD,
  };

  /*
   * Their guide shows a JSON body; the OAuth spec says form-encoded.
   *
   * RFC 6749 defines the token endpoint as taking
   * application/x-www-form-urlencoded, and most implementations refuse
   * anything else with a 400 — which is exactly what the exchange returned
   * for the JSON their own guide prints. A 400 is not a rejected
   * credential: a wrong secret is a 401, and this never got as far as
   * judging one.
   *
   * So both are attempted, documented shape first, because being wrong
   * about which one their server wants is not worth another round trip to
   * Dar. Whichever works is reported in the log so this can collapse to one
   * attempt once it is known.
   */
  const attempts: { label: string; headers: Record<string, string>; body: string }[] = [
    {
      label: "JSON body, Basic auth",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/json" },
      body: JSON.stringify(fields),
    },
    {
      label: "form body, Basic auth",
      headers: { authorization: `Basic ${basic}`,
                 "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    /*
     * The third variant: client credentials in the body instead of the
     * header.
     *
     * RFC 6749 permits both and plenty of servers accept only this one. It
     * is worth trying because the alternative is another round trip to Dar
     * to ask which, and because a 400 with no error body at all is what a
     * gateway returns when a required field is simply absent — which is
     * what the client id would be, from its point of view, if it is
     * expected here rather than in the header.
     */
    {
      label: "form body, credentials in body",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...fields, client_id: APPLICATION_ID, client_secret: ACCESS_SECRET,
      }).toString(),
    },
    /*
     * The fourth: their own field names.
     *
     * Their 4000 is "validation error, missing or invalid field" from their
     * own envelope, which means their application read the body and did not
     * recognise what was in it — not a gateway, not a credential. The
     * environment they issued names exactly four values, and a service that
     * wraps every response in { code, success, data } may well take them
     * under those names rather than OAuth's.
     */
    {
      label: "JSON body, their own field names",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        applicationId: APPLICATION_ID,
        accessSecret: ACCESS_SECRET,
        stakeholderUsername: STAKEHOLDER_USERNAME,
        stakeholderPassword: STAKEHOLDER_PASSWORD,
      }),
    },
  ];

  /* Every attempt's outcome, because reporting only the last hid the fact
     that the documented shape may fail differently from the guesses — and
     which of them fails how is the whole of the evidence here. */
  const tried: string[] = [];
  let last: DseCustodyError | null = null;

  for (const attempt of attempts) {
    const res = await fetch(`${BASE_URL}${TOKEN_PATH}`, {
      method: "POST",
      headers: { accept: "application/json", ...attempt.headers },
      body: attempt.body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = text ? JSON.parse(text) : {}; } catch { /* reported below */ }

    if (!res.ok) {
      /*
       * The server's own words, where it gives them.
       *
       * An OAuth failure carries `error` and `error_description`, and those
       * name the actual problem — "unsupported_grant_type",
       * "invalid_client" — far better than a status code can. Dropping them
       * was why a 400 read as a credential problem.
       */
      /*
       * Their words if they gave any, and otherwise the body itself.
       *
       * The first pass looked for OAuth's error fields and their envelope's
       * message, found none of them, and reported "it returned no reason" —
       * which was true and useless. A 400 carrying nothing an OAuth server
       * would send is itself the finding: it points at a gateway refusing
       * the request before the application saw it, and the only way to tell
       * is to look at what actually came back.
       */
      const named = [body.error, body.error_description, body.message, body.code]
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      if (Array.isArray(body.errors)) named.push(...body.errors.map(String));

      /* The response, never the request: the request holds the password.
         Truncated for the screen; the whole of it goes to the log. */
      const snippet = text.trim().replace(/\s+/g, " ").slice(0, 200);
      console.error(`CSD token attempt [${attempt.label}] -> HTTP ${res.status}`,
        { contentType: res.headers.get("content-type"), body: text.slice(0, 2000) });

      const detail = named.length
        ? named.join(": ")
        : snippet
          ? `the body was ${JSON.stringify(snippet)}`
          : `the response was empty (content-type ${res.headers.get("content-type") ?? "none"})`;

      tried.push(`${attempt.label} → ${res.status} ${detail}`);
      last = new DseCustodyError(
        "auth_failed",
        res.status === 404
          ? `The token endpoint was not found at ${TOKEN_PATH} (404). The path is wrong, not the credentials.`
          : `The exchange refused the token request. ${tried.join(" · ")}`,
        res.status || 502,
      );

      /* A 404 is the path and no body shape will fix it; anything else is
         worth the second encoding before giving up. */
      if (res.status === 404) throw last;
      continue;
    }

    const hit = findToken(body);

    if (!hit) {
      /* Key names only. The values are the credentials and a bearer token. */
      const nested = (body.data ?? {}) as Record<string, unknown>;
      console.error("CSD token response had no recognisable token. Top-level keys:",
        Object.keys(body), "data keys:", Object.keys(nested));
      throw new DseCustodyError(
        "token_shape",
        `The exchange accepted the request (${attempt.label}, HTTP ${res.status}) but the response `
        + `carried nothing shaped like a token. Its field names are in the server log.`,
        502,
      );
    }

    /* The field it was found under, so this can stop searching once it is
       known — and so a wrong pick is visible rather than silent. */
    console.info(`CSD token obtained with: ${attempt.label}; token read from "${hit.path}".`);

    /* An absent or unparseable lifetime is treated as one hour rather than
       forever: a token believed valid past its life fails every call until
       something clears the cache. */
    const ttlS = findExpiry(body);
    const lifeMs = ttlS ? ttlS * 1000 : 3_600_000;

    const refresh = findToken({ r: (body.refresh_token ?? body.refreshToken
      ?? (body.data as Record<string, unknown> | undefined)?.refresh_token
      ?? (body.data as Record<string, unknown> | undefined)?.refreshToken) })?.value ?? null;

    return { value: hit.value, refresh, expiresAt: Date.now() + lifeMs };
  }

  if (last) {
    /* Rebuilt once all attempts are in, so the message lists every shape
       tried rather than whichever happened to be last. */
    throw new DseCustodyError("auth_failed",
      `The exchange refused the token request. Tried: ${tried.join(" · ")}`, last.status);
  }
  throw new DseCustodyError("auth_failed", "The token request failed.", 502);
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

/**
 * The shape every call comes back in.
 *
 * `code` carries the result and `errors` the detail; the HTTP status does
 * not, and their guide says so outright — an error can arrive with HTTP 200.
 * So the body is read first and the status only consulted for transport
 * failures.
 *
 * `data.upstream.accepted` is the CSD's own answer, as distinct from the
 * exchange's. Their guide calls it the final confirmation.
 */
type Envelope<T> = {
  code?: string | number;
  success?: boolean;
  message?: string;
  data?: T;
  errors?: unknown;
  requestId?: string;
} & Record<string, unknown>;

async function call<T>(
  path: string, body: unknown, opts: { retried?: boolean } = {},
): Promise<{ data: T; requestId: string | null }> {
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

  const result = String(parsed.code ?? "");
  const known = RESULT[result];
  if (result !== "2000") {
    throw new DseCustodyError(
      known?.code ?? "unknown_result",
      /* Their message where there is one: the full code list is still to
         come, so an unrecognised code must carry its own number through
         rather than be flattened to "failed". */
      String(parsed.message ?? known?.message ?? `The CSD returned result code ${result || "none"}.`)
        + (Array.isArray(parsed.errors) && parsed.errors.length
            ? ` (${parsed.errors.map(String).join("; ")})` : ""),
      200,
      known?.retry ?? "verify",
    );
  }

  /* The requestId is what DSE support asks for, and their guide says to log
     every one. It rides out with the data so a caller can store it beside
     whatever the call produced. */
  return { data: (parsed.data ?? null) as T, requestId: parsed.requestId ?? null };
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
  const { data } = await call<HoldingRow[] | { holdings?: HoldingRow[] }>(
    "/stakeholder/api/v1/trading/holdings/by-cds",
    { cdsAccount: account },
  );

  const rows = Array.isArray(data) ? data : (data?.holdings ?? []);
  return rows.map((r: HoldingRow) => ({
    symbol: String(r.security ?? r.securityCode ?? r.symbol ?? "").toUpperCase(),
    totalBalance: num(r.totalBalance),
    freeBalance: num(r.freeBalance),
    pledgedBalance: num(r.pledgedBalance),
    reservedBalance: num(r.reservedBalance),
    pendingSale: num(r.pendingSale),
    pendingBuy: num(r.pendingBuy),
  })).filter((h: SecurityHolding) => h.symbol);
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

/**
 * The body both instructions take — a hold and a release are identical
 * except for the path.
 *
 * ## The field mapping is contested, and this is the dangerous part
 *
 * The exchange's guide and the exchange's email say opposite things about
 * two of these fields.
 *
 *   The guide (v1.0, November 2026) says `csdAccount` is the "investor's CSD
 *   (safe custody) account number", example 123456, and `brokerCode` is the
 *   "broker code of the pledgor", example BRK001.
 *
 *   Their email says the names are confusing and to use the opposite
 *   mapping: `csdAccount` is the broker's safe-custody account, example
 *   B21/C, and `brokerCode` is the investor's CDS account number.
 *
 * Both readings are coherent and only one can be right. Getting it wrong
 * pledges against the wrong account, which is not a mistake that announces
 * itself. So the arguments here are named by *meaning* rather than by their
 * wire names, and the mapping to the wire happens in exactly one place
 * below — if DSE confirms the email's version, that is two lines, not a
 * hunt through the file.
 *
 * The versioned document wins until a person says otherwise, because it is
 * the artefact they will point at later.
 */
export type PledgeRequest = {
  /** ISIN, not a ticker: the CSD identifies securities by TZ0000000001. */
  securityIsin: string;
  /** The security's short name, which the instruction also carries. */
  securityDesc: string;
  /** Whole shares. A fraction is refused rather than silently truncated. */
  quantity: number;
  /** The investor whose holding is pledged. */
  investorAccount: string;
  /** The pledgor's broker code. */
  brokerCode: string;
};

export type PledgeAccepted = {
  /** BALANCE for a hold, RELEASE for a release. */
  action: string;
  /**
   * Whether the CSD itself accepted it, which their guide calls the final
   * confirmation — as distinct from the 2000, which is only the exchange
   * saying it took the instruction. Null when absent, which their notes say
   * to treat as unconfirmed rather than as a yes.
   */
  upstreamAccepted: boolean | null;
  tradeDate: string | null;
  settlementDate: string | null;
  /** Log it: their guide asks for it on every support conversation. */
  requestId: string | null;
};

const PLEDGE_PATH = {
  hold: "/stakeholder/api/v1/pledge-instructions/balance",
  release: "/stakeholder/api/v1/pledge-instructions/release",
} as const;

/**
 * Places or releases a pledge. **Neither locks or unlocks anything on its
 * own return.**
 *
 * A 2000 means the exchange accepted the instruction. `upstreamAccepted`
 * says the CSD did, which is stronger and is what their guide calls final —
 * and their email says validation continues during processing even then. The
 * two statements do not agree, so this returns both and lets the caller
 * require the holdings to move as well: see confirmPledge. Believing the
 * weaker of two conflicting assurances costs a wasted poll, believing the
 * stronger one costs tokens minted against shares that were never locked.
 *
 * Their guide is explicit that a timeout must not be retried automatically.
 * The caller is expected to have recorded its intent before calling, because
 * there is no lookup by our own reference to ask with afterwards.
 */
async function instruct(
  kind: "hold" | "release", req: PledgeRequest,
): Promise<PledgeAccepted> {
  if (!DSE_BPID) {
    throw new DseCustodyError("not_configured", "No BPID is configured for CAPX.", 503);
  }
  if (!Number.isInteger(req.quantity) || req.quantity <= 0) {
    throw new DseCustodyError(
      "fractional_quantity",
      `The CSD accepts whole shares only; ${req.quantity} was given. `
      + `Round with pledgeQuantityFor() so the lock covers the claims rather than trailing them.`,
      400,
    );
  }
  if (!req.securityIsin.trim()) {
    throw new DseCustodyError(
      "no_isin",
      `No ISIN is recorded for this security, and the CSD will not take a ticker.`,
      400,
    );
  }

  /*
   * The one place meaning becomes a wire field. See the note on
   * PledgeRequest: these two assignments are what change if DSE confirms
   * their email rather than their guide.
   */
  const { data, requestId } = await call<Record<string, unknown>>(PLEDGE_PATH[kind], {
    securityIsin: req.securityIsin.trim().toUpperCase(),
    securityDesc: req.securityDesc,
    quantity: req.quantity,
    brokerCode: req.brokerCode,
    csdAccount: req.investorAccount,
    pledgeeBpid: DSE_BPID,
  });

  const upstream = (data?.upstream ?? null) as { accepted?: unknown } | null;
  const str = (k: string) => (typeof data?.[k] === "string" ? data[k] as string : null);

  return {
    action: str("action") ?? (kind === "hold" ? "BALANCE" : "RELEASE"),
    upstreamAccepted: typeof upstream?.accepted === "boolean" ? upstream.accepted : null,
    tradeDate: str("tradeDate"),
    settlementDate: str("settlementDate"),
    requestId,
  };
}

/** Locks a quantity in CAPX's favour. Confirm before minting against it. */
export const pledge = (req: PledgeRequest) => instruct("hold", req);

/**
 * Releases a previously pledged quantity.
 *
 * Identified by security, quantity and accounts rather than by a reference
 * to the hold that placed it — the instruction carries no pledge id, so
 * there is nothing to quote. A release is therefore a statement about a
 * quantity, not about a particular earlier pledge, and the burn it follows
 * has to be reconciled against the holdings rather than against a chain of
 * instruction ids.
 */
export const releasePledge = (req: PledgeRequest) => instruct("release", req);

export type PledgeConfirmation = {
  confirmed: boolean;
  /** What the CSD says is pledged now. */
  pledgedBalance: number;
  /** What it said before the instruction, for the comparison. */
  wasPledged: number;
  shortBy: number;
};

/**
 * The evidence a pledge actually happened.
 *
 * Reads the CSD's holdings and asks whether `pledgedBalance` has risen by at
 * least what was asked for. Deliberately a comparison against a figure taken
 * *before* the instruction rather than a check that the total looks about
 * right: a security can be pledged for several reasons at once, and an
 * absolute threshold would read somebody else's lock as ours.
 *
 * This runs even when the instruction came back with `upstreamAccepted`
 * true, which their guide calls the final confirmation. Their email says
 * validation continues inside the CSD after acceptance, and the two
 * statements cannot both be complete. The cost of believing the weaker one
 * is a poll that was not needed; the cost of believing the stronger one, if
 * it turns out to be the email that was right, is tokens minted against
 * shares nothing locked. So the holdings are read either way.
 *
 * An unconfirmed result is not a failure. The CSD may still be processing,
 * so "not yet" and "rejected" look identical here until they tell us how
 * rejections are communicated — which is why this reports what it saw and
 * refuses to guess which. The caller waits, and escalates to a person rather
 * than resending: their guide says not to retry automatically, and there is
 * no lookup by our own reference to ask with.
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

/**
 * The mirror, for a release: has the pledged balance actually fallen?
 *
 * Needed as its own function rather than a negated confirmPledge because the
 * comparison runs the other way and a sign error here would report a lock
 * still in place as released — which is the direction that lets a share be
 * sold twice.
 */
export async function confirmRelease(args: {
  investorAccount: CdsAccount;
  symbol: string;
  quantity: number;
  wasPledged: number;
}): Promise<PledgeConfirmation> {
  const holding = await holdingOf(args.investorAccount, args.symbol);
  const pledgedBalance = holding?.pledgedBalance ?? 0;
  const freed = args.wasPledged - pledgedBalance;
  return {
    confirmed: freed >= args.quantity,
    pledgedBalance,
    wasPledged: args.wasPledged,
    shortBy: Math.max(0, args.quantity - freed),
  };
}


/**
 * Why a call to the exchange did not work, in a sentence with a next step.
 *
 * An unreadable exchange is reported as unreadable everywhere else in this
 * codebase, deliberately: treating it as zero would read as a total breach
 * when it is a network problem. But "could not be read" is where the
 * investigation starts, not where it ends, and swallowing the cause leaves
 * the desk with nothing to act on — the first time this ran against real
 * credentials it said exactly that and nothing more.
 *
 * So the cause is named for CAPX's own desk. It never reaches the exchange's
 * oversight portal, which has no business seeing which of our settings is
 * wrong.
 */
export function describeCsdFailure(e: unknown): string {
  if (e instanceof DseCustodyError) {
    switch (e.code) {
      case "not_configured":
        return "the CSD credentials are not all set on this deployment";
      /*
       * The thrown message, not a sentence written here.
       *
       * requestToken already distinguishes a 401 from a 404 from a 200 it
       * could not parse, and each points somewhere different. Restating it
       * as one fixed line threw that away and sent somebody to check an
       * application id over what may have been a wrong path.
       */
      case "auth_failed":
      case "token_shape":
        return e.message;
      case "unauthenticated":
        return "the exchange rejected the access token twice, which usually means the "
          + "stakeholder username or password is wrong";
      case "bad_account":
        return `the configured account was refused: ${e.message}`;
      case "unreachable":
        return "the exchange did not answer";
      case "validation":
        return `the exchange refused the request: ${e.message}`;
      case "csd_error":
        return "the CSD reported a server error";
      default:
        return e.message;
    }
  }
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const first = raw.split("\n")[0].trim();
  return first.length > 160 ? `${first.slice(0, 157)}\u2026` : first || "the call failed";
}
