import "server-only";
import { randomUUID } from "crypto";

/**
 * nTZS partner API client.
 *
 * nTZS is a Tanzanian shilling stablecoin on Base. CAPX uses it as a TZS
 * on-ramp: collect mobile money, mint nTZS, convert to USDC, then send that
 * USDC to the user's own wallet — which is where CAPX's involvement in the
 * money begins. nTZS wallets are custodial and the API cannot sign an arbitrary
 * contract call, so the shares are always bought by a wallet the user controls.
 *
 * The API key is a partner secret and must never reach the browser; everything
 * here is server-only.
 */

const BASE_URL = process.env.NTZS_BASE_URL ?? "https://www.ntzs.co.tz";
const API_KEY = process.env.NTZS_API_KEY ?? "";

export const ntzsConfigured = API_KEY.length > 0;
/** Test keys simulate the chain and the payment rails; live keys move money. */
export const ntzsLiveMode = API_KEY.startsWith("ntzs_live_");

export class NtzsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retry: "no" | "backoff" | "verify" = "no",
  ) {
    super(message);
    this.name = "NtzsError";
  }
}

/**
 * The catalogue returns the machine code in `error` for most paths but in
 * `code` for identity and KYC, and authentication failures carry prose only.
 * Reading `error` alone mis-handles about a third of it, so branch on both.
 */
function toError(status: number, body: unknown): NtzsError {
  const b = (body ?? {}) as { error?: string; code?: string; message?: string };
  const code = b.code ?? (b.message ? b.error : undefined) ?? `http_${status}`;
  const message = b.message ?? b.error ?? `nTZS request failed (${status})`;
  const retry = status >= 500 ? "verify" : status === 429 ? "backoff" : "no";
  return new NtzsError(code, message, status, retry);
}

type CallOpts = { method?: "GET" | "POST"; body?: unknown; idempotent?: boolean; auth?: boolean };

async function call<T>(path: string, opts: CallOpts = {}): Promise<T> {
  const { method = "GET", body, idempotent = false, auth = true } = opts;
  if (auth && !ntzsConfigured) {
    throw new NtzsError("not_configured", "nTZS is not configured on this deployment", 503);
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (auth) headers.authorization = `Bearer ${API_KEY}`;
  if (body) headers["content-type"] = "application/json";
  // A 502 can mean the request was taken but not confirmed; without a key a
  // retry can collect or pay twice.
  if (idempotent) headers["idempotency-key"] = randomUUID();

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: text.slice(0, 200) }; }
  if (!res.ok) throw toError(res.status, parsed);
  return parsed as T;
}

/* ---------------------------------------------------------------- rates -- */

export type SwapRate = {
  rate?: number;
  expectedOutput?: number;
  minOutput?: number;
  lowLiquidity?: boolean;
  [k: string]: unknown;
};

/** Public endpoint — no key. Valid ~30s, so never cache it past that. */
export async function getSwapRate(from: "NTZS" | "USDC", to: "NTZS" | "USDC", amount: number) {
  const q = new URLSearchParams({ from, to, amount: String(amount) });
  return call<SwapRate>(`/api/v1/swap/rate?${q}`, { auth: false });
}

/* ---------------------------------------------------------------- users -- */

export type NtzsUser = {
  id: string;
  externalId?: string;
  email?: string;
  walletAddress?: string | null;
  balanceTzs?: number;
  balanceUsdc?: number;
  kycStatus?: string;
  [k: string]: unknown;
};

/**
 * Idempotent on externalId, so CAPX keys the nTZS account to the user's own
 * wallet address. That means no CAPX user database: the wallet is the
 * identity, and calling this again on every sign-in returns the same account.
 */
export async function upsertUser(input: {
  externalId: string;
  email: string;
  name?: string;
  phone?: string;
  nidaNumber?: string;
  country?: string;
}) {
  return call<NtzsUser>("/api/v1/users", { method: "POST", body: input, idempotent: true });
}

/**
 * Creates a partner sub-user that is provisioned with a spendable wallet.
 *
 * `/api/v1/users` registers a record but does not always give it a wallet, and
 * a deposit into a walletless user is rejected ("User has no wallet"). The
 * partners endpoint is the one that provisions the wallet the omnibus needs to
 * hold shillings and to swap and transfer from. Idempotent on externalId, so it
 * cannot create a second omnibus.
 */
export async function createPartnerUser(input: {
  externalId: string;
  email: string;
  name?: string;
  phone?: string;
  nidaNumber?: string;
  country?: string;
}) {
  return call<NtzsUser>("/api/v1/partners/users", { method: "POST", body: input, idempotent: true });
}

export async function getUser(id: string) {
  return call<NtzsUser>(`/api/v1/users/${encodeURIComponent(id)}`);
}

/* ------------------------------------------------------------- deposits -- */

/**
 * Mobile money in; nTZS mints 1:1. Minimum 500 TZS, whole shillings only.
 *
 * `userId` is optional on purpose: omit it and the collection lands in the
 * partner treasury rather than a per-user wallet. Every account has a treasury
 * with no grant needed, so that is the path when `wallets` is not held — which
 * suits an omnibus model anyway, since CAPX attributes deposits in its own
 * ledger rather than upstream.
 */
export type PaymentMethod = "mobile_money" | "bank_transfer" | "card" | "lipa_namba";

export async function createDeposit(input: {
  userId?: string;
  amountTzs: number;
  phoneNumber: string;
  paymentMethod?: PaymentMethod;
}) {
  const amount = Math.round(input.amountTzs);
  const body: Record<string, unknown> = {
    amountTzs: amount,
    tzsAmount: amount,
    phoneNumber: input.phoneNumber,
    paymentMethod: input.paymentMethod ?? "mobile_money",
  };
  if (input.userId) body.userId = input.userId;
  return call<{ id: string; status: string; [k: string]: unknown }>("/api/v1/deposits", {
    method: "POST", body, idempotent: true,
  });
}

/* --------------------------------------------------------- disbursements -- */

/** Price a payout before executing it. `amountTzs` is what the recipient gets. */
export async function withdrawalQuote(input: { userId: string; amountTzs: number; phoneNumber: string }) {
  const amount = Math.round(input.amountTzs);
  return call<{ quoteId?: string | null; recipientName?: string | null; totalFeeTzs?: number;
                [k: string]: unknown }>("/api/v1/withdrawals/quote", {
    // Both spellings, for the same reason as the ramp quote: the deployment has
    // asked for `tzsAmount` where the spec says otherwise, and the values are
    // identical so whichever it reads is correct.
    method: "POST",
    body: { userId: input.userId, amountTzs: amount, tzsAmount: amount, phoneNumber: input.phoneNumber },
  });
}

/** Execute against a quote. Terms must match it exactly or it is rejected. */
export async function createWithdrawal(input: { userId: string; quoteId: string; amountTzs: number; phoneNumber: string }) {
  return call<{ id?: string; status?: string; [k: string]: unknown }>("/api/v1/withdrawals", {
    method: "POST",
    body: {
      userId: input.userId,
      quoteId: input.quoteId,
      amountTzs: Math.round(input.amountTzs),
      tzsAmount: Math.round(input.amountTzs),
      phoneNumber: input.phoneNumber,
    },
    idempotent: true,
  });
}

export async function getWithdrawal(id: string) {
  return call<{ id?: string; status?: string; [k: string]: unknown }>(
    `/api/v1/withdrawals/${encodeURIComponent(id)}`,
  );
}

/** Resolve the registered name behind a number. Fail-soft: null is not an error. */
export async function lookupRecipient(phoneNumber: string) {
  return call<{ name?: string | null }>("/api/v1/lookup/recipient-name", {
    method: "POST", body: { phoneNumber },
  }).catch(() => ({ name: null }));
}

export async function getDeposit(id: string) {
  return call<{ id: string; status: string; [k: string]: unknown }>(
    `/api/v1/deposits/${encodeURIComponent(id)}`,
  );
}

/* ----------------------------------------------------------------- swap -- */

/**
 * The swap responds as an SSE stream so a caller can show each leg. CAPX
 * only needs the outcome, so this drains the stream and returns the terminal
 * event.
 */
export async function swap(input: {
  userId: string;
  from: "NTZS" | "USDC";
  to: "NTZS" | "USDC";
  amount: number;
}) {
  if (!ntzsConfigured) throw new NtzsError("not_configured", "nTZS is not configured", 503);

  const res = await fetch(`${BASE_URL}/api/v1/swap`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* stream with no JSON body */ }
    throw toError(res.status, body);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let last: Record<string, unknown> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
        last = evt;
        const status = String(evt.status ?? "").toUpperCase();
        if (status === "FAILED") {
          throw new NtzsError(
            String(evt.code ?? "swap_failed"),
            String(evt.message ?? evt.error ?? "Swap failed"),
            502,
            "verify",
          );
        }
      } catch (e) {
        if (e instanceof NtzsError) throw e;
        /* a non-JSON keepalive frame */
      }
    }
  }
  return last ?? {};
}

/* ------------------------------------------------------------ transfers -- */

/**
 * Sends the user's own USDC out to their own wallet. `amountTzs` carries the
 * amount for both tokens in this API — for USDC it is read as a plain amount.
 */
export async function transferUsdc(input: { fromUserId: string; toAddress: string; amount: number }) {
  return call<{ id?: string; txHash?: string; [k: string]: unknown }>("/api/v1/transfers", {
    method: "POST",
    body: {
      fromUserId: input.fromUserId,
      toAddress: input.toAddress,
      token: "USDC",
      amountTzs: input.amount,
      metadata: { source: "capx", purpose: "fund_trading_wallet" },
    },
    idempotent: true,
  });
}

/* ------------------------------------------------------------------ ramp -- */

/**
 * Wallet-less settlement: mobile money straight to USDC, with no per-user
 * wallets and no swap leg. This is the path for a partner without the `wallets`
 * capability, which is granted per partner rather than by default.
 *
 * Quote first, then execute against the quote — the rate is locked for 60
 * seconds and the fee must never be recomputed locally.
 */
export type RampQuote = {
  quoteId?: string;
  id?: string;
  amount?: number;
  usdcAmount?: number;
  rate?: number;
  expiresAt?: string;
  [k: string]: unknown;
};

/**
 * The published spec names this field `amount`; the deployed API rejects that
 * and asks for `tzsAmount`. Both are sent — the extra key is ignored by
 * whichever side is right, and the call works against either.
 */
export async function rampQuote(input: {
  direction: "onramp" | "offramp";
  amount: number;
  phoneNumber?: string;
}) {
  return call<RampQuote>("/api/v1/ramp/quote", {
    method: "POST",
    body: {
      direction: input.direction,
      amount: Math.round(input.amount),
      tzsAmount: Math.round(input.amount),
      ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
    },
  });
}

/**
 * Minimum collection per route, in whole shillings.
 *
 * Ramp settles over the same rail as a payout and carries the payout minimum;
 * a plain deposit does not. The docs give 5,000 for withdrawals and 500 for
 * deposits, and the live API confirms ramp follows the former.
 */
export const MIN_TZS_BY_ROUTE: Record<string, number> = {
  ramp: 5_000,
  treasury: 500,
  "omnibus-wallet": 500,
};

/** A 202 here is success-in-flight, not a failure — track it with rampStatus. */
export async function rampOnramp(input: { quoteId: string; phoneNumber: string }) {
  return call<{ id?: string; status?: string; [k: string]: unknown }>("/api/v1/ramp/onramp", {
    method: "POST", body: input, idempotent: true,
  });
}

export async function rampStatus(id: string) {
  return call<{ id?: string; status?: string; [k: string]: unknown }>(
    `/api/v1/ramp/${encodeURIComponent(id)}`,
  );
}

/** Recent ramp settlements, for matching a deposit we cannot look up by id. */
export async function rampSettlements() {
  return call<{ settlements?: unknown[]; data?: unknown[]; [k: string]: unknown }>(
    "/api/v1/ramp/settlements",
  );
}

/** The partner's USDC settlement float. Read-only, so it doubles as a probe. */
export async function rampBalance() {
  return call<{ balance?: number; usdc?: number; [k: string]: unknown }>("/api/v1/ramp/balance");
}

/* ---------------------------------------------------------- capabilities -- */

export type Capability = "wallets" | "ramp" | "collections";

/**
 * What this key can actually do.
 *
 * Capabilities are granted per partner and an endpoint outside the grant
 * answers 403 no matter how valid the key is, so the only honest way to know is
 * to ask. Both probes are safe: the ramp probe is a balance read, and user
 * creation is idempotent on externalId — it returns the omnibus account rather
 * than creating a second one.
 */
export async function probeCapabilities(omnibusExternalId: string, omnibusEmail: string) {
  const result: Record<Capability, { available: boolean; detail?: string }> = {
    wallets: { available: false },
    ramp: { available: false },
    collections: { available: false },
  };

  await Promise.all([
    // Reading a deposit that cannot exist: a 404 means the endpoint is open to
    // this key, a 403 means the capability is not granted. Nothing is collected
    // either way.
    getDeposit("00000000-0000-0000-0000-000000000000")
      .then(() => { result.collections = { available: true }; })
      .catch((e) => {
        const err = e as NtzsError;
        const denied = err?.status === 403;
        result.collections = { available: !denied, detail: denied ? err.message : undefined };
      }),
    rampBalance()
      .then(() => { result.ramp = { available: true }; })
      .catch((e) => { result.ramp = { available: false, detail: e instanceof Error ? e.message : "unavailable" }; }),
    upsertUser({ externalId: omnibusExternalId, email: omnibusEmail, name: "CAPX Treasury" })
      .then((u) => { result.wallets = { available: true, detail: u.id }; })
      .catch((e) => { result.wallets = { available: false, detail: e instanceof Error ? e.message : "unavailable" }; }),
  ]);

  return result;
}
