import "server-only";
import { NextResponse } from "next/server";
import { db, dbConfigured, migrate } from "./db";
import { callerFor, replay, remember, type Caller } from "./partners";
import type { SessionUser } from "./auth";

/**
 * The shape every partner endpoint shares.
 *
 * Authentication, the approval gate, the test-mode rule and idempotency are
 * the same four questions on every route, and answering them in each handler
 * is how they come to differ. They are answered once, here.
 */

export type ApiFail = { ok: false; code: string; error: string; status: number };

export const fail = (code: string, error: string, status = 400): ApiFail =>
  ({ ok: false, code, error, status });

export const send = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export const sendFail = (f: ApiFail) => {
  const { status, ...rest } = f;
  return NextResponse.json(rest, { status, headers: { "cache-control": "no-store" } });
};

/**
 * What a test key may not do.
 *
 * Test keys exist so a partner can build the integration while their
 * application is still being read. They can see everything and create
 * customers; they cannot move a shilling. There is deliberately no simulated
 * money — a fake order path would be a second implementation of the thing
 * that matters most, and the day it drifted from the real one it would be
 * lying to the people relying on it most.
 */
const MOVES_MONEY = true;

export type Handler = (ctx: {
  caller: Caller;
  body: Record<string, unknown>;
  req: Request;
}) => Promise<NextResponse>;

export function partnerRoute(
  route: string,
  opts: { movesMoney?: boolean; idempotent?: boolean },
  handler: Handler,
) {
  return async (req: Request): Promise<NextResponse> => {
    if (!dbConfigured) {
      return sendFail(fail("not_configured", "This deployment has no database.", 503));
    }
    const caller = await callerFor(req);
    if (!caller) {
      return sendFail(fail("unauthorised",
        "Send your key as `Authorization: Bearer cpx_live_…`.", 401));
    }

    if (caller.partner.status === "suspended") {
      return sendFail(fail("suspended",
        "This partner account is suspended. Contact CAPX.", 403));
    }
    if (caller.partner.status === "rejected") {
      return sendFail(fail("rejected", "This partner application was not accepted.", 403));
    }
    if (opts.movesMoney === MOVES_MONEY && caller.mode === "test") {
      return sendFail(fail("test_mode",
        "A test key cannot move money. Ask CAPX for a live key once your application is approved.",
        403));
    }
    if (opts.movesMoney === MOVES_MONEY && caller.partner.status !== "approved") {
      return sendFail(fail("not_approved",
        "This partner is not approved yet, so live calls are refused. Test keys keep working.",
        403));
    }

    let body: Record<string, unknown> = {};
    if (req.method !== "GET") {
      body = await req.json().catch(() => ({})) as Record<string, unknown>;
    }

    /* The same key gets the same answer, forever. */
    const idem = (req.headers.get("idempotency-key") ?? "").trim();
    if (opts.idempotent && idem) {
      const seen = await replay(caller.partner.id, idem);
      if (seen) {
        return NextResponse.json(seen.body, {
          status: seen.status,
          headers: { "cache-control": "no-store", "idempotent-replay": "true" },
        });
      }
    }

    const res = await handler({ caller, body, req });

    if (opts.idempotent && idem && res.status < 500) {
      const copy = await res.clone().json().catch(() => null);
      if (copy !== null) await remember(caller.partner.id, idem, route, res.status, copy);
    }
    return res;
  };
}

/**
 * Loads one of the partner's own customers as the trading paths expect them.
 *
 * Scoped to the partner on the way in rather than checked afterwards: a
 * partner can only ever name a customer they introduced, so there is no
 * ordering of these lines in which one partner reads another's book.
 */
export async function partnerCustomer(
  partnerId: string, ref: string,
): Promise<SessionUser | null> {
  await migrate();
  const sql = db();
  const byUuid = /^[0-9a-f-]{36}$/i.test(ref);
  const uuid = byUuid ? ref : "00000000-0000-0000-0000-000000000000";

  /*
   * Two ways a person can be this partner's to act for, and both are checked
   * here rather than at the call sites.
   *
   * Introduced: the partner created them, and users.partner_id says so.
   * Linked: they already had a CAPX account and consented to this partner
   * reaching it, which lives in partner_links and leaves partner_id alone —
   * an access grant is not a change of whose customer somebody is.
   *
   * Scoped to the partner on the way in either way, so there is no ordering
   * of these lines in which one partner reads another's book, and a revoked
   * link stops resolving the moment it is revoked.
   */
  const [u] = await sql<{ id: string; email: string; username: string | null; name: string | null;
                          phone: string | null; country: string | null; kyc_status: string;
                          nida_number: string | null }[]>`
    select u.id::text, u.email, u.username, u.name, u.phone, u.country, u.kyc_status,
           u.nida_number
      from capx.users u
      left join capx.partner_links l
        on l.user_id = u.id and l.partner_id = ${partnerId}::uuid and l.status = 'active'
     where (u.partner_id = ${partnerId}::uuid or l.id is not null)
       and (${byUuid} and u.id = ${uuid}::uuid
            or u.partner_ref = ${ref}
            or l.reference = ${ref})
     limit 1`;
  if (!u) return null;
  return {
    id: u.id, email: u.email, username: u.username, name: u.name, phone: u.phone,
    country: u.country ?? "TZ", avatar: null, ntzsUserId: null,
    kycStatus: u.kyc_status, nidaNumber: u.nida_number,
  } as SessionUser;
}

/** Everything a partner is allowed to know about one of their customers. */
export async function customerView(userId: string) {
  await migrate();
  const sql = db();
  const { balances } = await import("./ledger");
  const [u] = await sql<{ id: string; email: string; name: string | null; phone: string | null;
                          country: string; kyc_status: string; partner_ref: string | null;
                          created_at: string }[]>`
    select id::text, email, name, phone, country, kyc_status, partner_ref, created_at
      from capx.users where id = ${userId}::uuid`;
  if (!u) return null;
  const bal = await balances(u.id).catch(() => []);
  return {
    id: u.id,
    reference: u.partner_ref,
    email: u.email,
    name: u.name,
    phone: u.phone,
    country: u.country,
    kyc_status: u.kyc_status,
    created_at: u.created_at,
    balances: bal.map((b) => ({ asset: b.asset, amount: b.amount })),
  };
}

/** Refuses an order that breaches a ceiling the partner agreed to. */
export async function partnerLimitRefusal(
  partnerId: string, maxOrderTzs: number | null, maxDailyTzs: number | null, amountTzs: number,
): Promise<ApiFail | null> {
  if (maxOrderTzs !== null && amountTzs > maxOrderTzs) {
    return fail("order_too_large",
      `Orders through this partner are capped at ${Math.round(maxOrderTzs).toLocaleString()} TZS.`,
      409);
  }
  if (maxDailyTzs === null) return null;

  await migrate();
  const [row] = await db()<{ total: string }[]>`
    select coalesce(sum(abs(l.amount)), 0)::text as total
      from capx.orders o
      join capx.users u on u.id = o.user_id
      join capx.ledger_entries l on l.ref = o.id::text || ':cash' and l.asset = 'TZS'
     where u.partner_id = ${partnerId}::uuid and o.status = 'settled'
       and o.created_at >= date_trunc('day', now() at time zone 'utc')`;
  const today = Number(row?.total ?? 0);
  if (today + amountTzs > maxDailyTzs) {
    return fail("daily_limit",
      `This partner's customers have traded ${Math.round(today).toLocaleString()} TZS today ` +
      `against a daily limit of ${Math.round(maxDailyTzs).toLocaleString()} TZS.`, 409);
  }
  return null;
}
