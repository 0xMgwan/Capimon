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

export async function getUser(id: string) {
  return call<NtzsUser>(`/api/v1/users/${encodeURIComponent(id)}`);
}

/* ------------------------------------------------------------- deposits -- */

/** Mobile money in; nTZS mints 1:1. Minimum 500 TZS, whole shillings only. */
export async function createDeposit(input: { userId: string; amountTzs: number; phoneNumber: string }) {
  return call<{ id: string; status: string; [k: string]: unknown }>("/api/v1/deposits", {
    method: "POST",
    body: { ...input, amountTzs: Math.round(input.amountTzs), paymentMethod: "mobile_money" },
    idempotent: true,
  });
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
