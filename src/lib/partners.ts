import "server-only";
import { createHash, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { db, dbConfigured, migrate } from "./db";

/**
 * Partners: companies that put CAPX inside their own product.
 *
 * The whole design is one sentence — a partner's customer is an ordinary CAPX
 * customer with a partner_id on them. Their balance is a row in the same
 * ledger, their shares are in the same custody, their order goes through the
 * same placeSecurityOrder with the same refusals, and solvency counts them
 * like anybody else.
 *
 * That is deliberate and it is the only version worth building. A separate
 * book for partner customers would need its own backing, its own solvency
 * check and its own reconciliation, and the first time the two disagreed
 * somebody's shares would be in the gap between them.
 */

export type PartnerStatus = "pending" | "approved" | "suspended" | "rejected";

export type Partner = {
  id: string;
  name: string;
  slug: string;
  status: PartnerStatus;
  contactName: string | null;
  contactEmail: string;
  contactPhone: string | null;
  companyReg: string | null;
  country: string;
  website: string | null;
  useCase: string | null;
  expectedUsers: number | null;
  feeBps: number;
  maxOrderTzs: number | null;
  maxDailyTzs: number | null;
  webhookUrl: string | null;
  createdAt: string;
};

type Row = {
  id: string; name: string; slug: string; status: string;
  contact_name: string | null; contact_email: string; contact_phone: string | null;
  company_reg: string | null; country: string; website: string | null;
  use_case: string | null; expected_users: number | null; fee_bps: number;
  max_order_tzs: string | null; max_daily_tzs: string | null;
  webhook_url: string | null; created_at: string;
};

const toPartner = (r: Row): Partner => ({
  id: r.id, name: r.name, slug: r.slug, status: r.status as PartnerStatus,
  contactName: r.contact_name, contactEmail: r.contact_email, contactPhone: r.contact_phone,
  companyReg: r.company_reg, country: r.country, website: r.website,
  useCase: r.use_case, expectedUsers: r.expected_users, feeBps: Number(r.fee_bps ?? 0),
  maxOrderTzs: r.max_order_tzs === null ? null : Number(r.max_order_tzs),
  maxDailyTzs: r.max_daily_tzs === null ? null : Number(r.max_daily_tzs),
  webhookUrl: r.webhook_url, createdAt: r.created_at,
});

const SELECT = `id::text, name, slug, status, contact_name, contact_email, contact_phone,
                company_reg, country, website, use_case, expected_users, fee_bps,
                max_order_tzs::text, max_daily_tzs::text, webhook_url, created_at`;

export const hashKey = (key: string) =>
  createHash("sha256").update(key.trim()).digest("hex");

/**
 * A key the holder can read once.
 *
 * The mode is in the key itself so that a live key pasted into a test config
 * is obvious on sight, which is the moment it can still be caught.
 */
export function mintKey(mode: "live" | "test") {
  const key = `cpx_${mode}_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, 16) };
}

/** A slug that is readable, unique-able, and safe in a URL. */
export const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "partner";

export type Caller = { partner: Partner; mode: "live" | "test"; keyId: string };

/**
 * Who is calling, from the Authorization header.
 *
 * Returns null for anything unrecognised and never says which part was wrong.
 * A key that is merely revoked and a key that never existed get the same
 * answer, because the difference is only useful to somebody guessing.
 */
export async function callerFor(req: Request): Promise<Caller | null> {
  if (!dbConfigured) return null;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!given.startsWith("cpx_")) return null;

  await migrate();
  const sql = db();
  const [row] = await sql<(Row & { key_id: string; mode: string })[]>`
    select ${sql.unsafe(SELECT.split(",").map((c) => `p.${c.trim()}`).join(", "))},
           k.id::text as key_id, k.mode
      from capx.partner_keys k
      join capx.partners p on p.id = k.partner_id
     where k.key_hash = ${hashKey(given)} and k.revoked_at is null`;
  if (!row) return null;

  /* Touched rather than counted: a last-used stamp is what tells a partner
     which of their keys is still wired into something. */
  void sql`update capx.partner_keys set last_used_at = now() where id = ${row.key_id}::uuid`
    .catch(() => {});

  return { partner: toPartner(row), mode: row.mode === "live" ? "live" : "test", keyId: row.key_id };
}

export async function partnerById(id: string): Promise<Partner | null> {
  if (!dbConfigured) return null;
  await migrate();
  const [row] = await db()<Row[]>`
    select ${db().unsafe(SELECT)} from capx.partners where id = ${id}::uuid`;
  return row ? toPartner(row) : null;
}

export async function partners(): Promise<Partner[]> {
  if (!dbConfigured) return [];
  await migrate();
  const rows = await db()<Row[]>`
    select ${db().unsafe(SELECT)} from capx.partners order by created_at desc`;
  return rows.map(toPartner);
}

/**
 * Records an application. Approval is a separate, human act.
 *
 * Anyone can apply and nobody is live on applying — the row exists so there is
 * something to review, and a test key is issued immediately so they can build
 * against the API while they wait. A test key cannot move money.
 */
export async function applyToPartner(input: {
  name: string; contactName?: string; contactEmail: string; contactPhone?: string;
  companyReg?: string; country?: string; website?: string;
  useCase?: string; expectedUsers?: number;
}): Promise<{ partner: Partner; testKey: string }> {
  await migrate();
  const sql = db();

  let slug = slugify(input.name);
  for (let i = 2; i < 50; i++) {
    const [clash] = await sql`select 1 from capx.partners where lower(slug) = ${slug}`;
    if (!clash) break;
    slug = `${slugify(input.name)}-${i}`;
  }

  const [row] = await sql<Row[]>`
    insert into capx.partners
      (name, slug, contact_name, contact_email, contact_phone, company_reg,
       country, website, use_case, expected_users)
    values (${input.name}, ${slug}, ${input.contactName ?? null}, ${input.contactEmail},
            ${input.contactPhone ?? null}, ${input.companyReg ?? null},
            ${(input.country ?? "TZ").toUpperCase()}, ${input.website ?? null},
            ${input.useCase ?? null}, ${input.expectedUsers ?? null})
    returning ${sql.unsafe(SELECT)}`;

  const partner = toPartner(row);
  const { key, hash, prefix } = mintKey("test");
  await sql`
    insert into capx.partner_keys (partner_id, mode, label, key_hash, key_prefix)
    values (${partner.id}::uuid, 'test', 'Initial test key', ${hash}, ${prefix})`;

  return { partner, testKey: key };
}

/** Issues a key and returns it once. */
export async function issueKey(partnerId: string, mode: "live" | "test", label?: string) {
  await migrate();
  const { key, hash, prefix } = mintKey(mode);
  await db()`
    insert into capx.partner_keys (partner_id, mode, label, key_hash, key_prefix)
    values (${partnerId}::uuid, ${mode}, ${label ?? null}, ${hash}, ${prefix})`;
  return key;
}

export async function revokeKey(partnerId: string, keyId: string) {
  await migrate();
  await db()`
    update capx.partner_keys set revoked_at = now()
     where id = ${keyId}::uuid and partner_id = ${partnerId}::uuid and revoked_at is null`;
}

export async function keysFor(partnerId: string) {
  await migrate();
  return db()<{ id: string; mode: string; label: string | null; key_prefix: string;
                last_used_at: string | null; created_at: string; revoked_at: string | null }[]>`
    select id::text, mode, label, key_prefix, last_used_at, created_at, revoked_at
      from capx.partner_keys where partner_id = ${partnerId}::uuid
     order by created_at desc`;
}

/**
 * What a partner has actually done, for their dashboard and for ours.
 *
 * Volumes are read from settled orders joined to the customers that partner
 * introduced, so the figure cannot drift from the ledger: there is no counter
 * to keep in step.
 */
export async function usageFor(partnerId: string, days = 30) {
  await migrate();
  const sql = db();
  const [totals] = await sql<{ users: number; verified: number; orders: number;
                               tzs: string; usdc: string }[]>`
    select
      (select count(*)::int from capx.users where partner_id = ${partnerId}::uuid) as users,
      (select count(*)::int from capx.users
        where partner_id = ${partnerId}::uuid and kyc_status = 'approved') as verified,
      (select count(*)::int from capx.orders o join capx.users u on u.id = o.user_id
        where u.partner_id = ${partnerId}::uuid and o.status = 'settled') as orders,
      (select coalesce(sum(abs(l.amount)), 0)::text
         from capx.orders o
         join capx.users u on u.id = o.user_id
         join capx.ledger_entries l on l.ref = o.id::text || ':cash' and l.asset = 'TZS'
        where u.partner_id = ${partnerId}::uuid and o.status = 'settled') as tzs,
      (select coalesce(sum(o.usdc_amount), 0)::text from capx.orders o
         join capx.users u on u.id = o.user_id
        where u.partner_id = ${partnerId}::uuid and o.status = 'settled') as usdc`;

  const daily = await sql<{ day: string; orders: number; tzs: string }[]>`
    with span as (
      select generate_series((now() at time zone 'utc')::date - ${days - 1}::int,
                             (now() at time zone 'utc')::date, interval '1 day')::date as day
    )
    select span.day::text,
           coalesce(count(o.id), 0)::int as orders,
           coalesce(sum(abs(l.amount)), 0)::text as tzs
      from span
      left join capx.orders o
        on o.created_at::date = span.day and o.status = 'settled'
       and o.user_id in (select id from capx.users where partner_id = ${partnerId}::uuid)
      left join capx.ledger_entries l on l.ref = o.id::text || ':cash' and l.asset = 'TZS'
     group by span.day order by span.day`;

  return {
    users: totals?.users ?? 0,
    verified: totals?.verified ?? 0,
    orders: totals?.orders ?? 0,
    volumeTzs: Number(totals?.tzs ?? 0),
    volumeUsdc: Number(totals?.usdc ?? 0),
    daily: daily.map((d) => ({ day: d.day, orders: d.orders, tzs: Number(d.tzs) })),
  };
}

/**
 * Replays the answer a partner already got, if they are asking again.
 *
 * Keyed on the partner and their own Idempotency-Key, so a retry after a
 * dropped connection returns the original response rather than placing a
 * second order. Without it a partner either double-charges their customer or
 * is afraid to retry at all.
 */
export async function replay(partnerId: string, key: string) {
  if (!key) return null;
  await migrate();
  const [row] = await db()<{ status_code: number; response: unknown }[]>`
    select status_code, response from capx.partner_requests
     where partner_id = ${partnerId}::uuid and idempotency_key = ${key}`;
  return row ? { status: row.status_code, body: row.response } : null;
}

export async function remember(
  partnerId: string, key: string, route: string, status: number, body: unknown,
) {
  if (!key) return;
  await migrate();
  await db()`
    insert into capx.partner_requests (partner_id, idempotency_key, route, status_code, response)
    values (${partnerId}::uuid, ${key}, ${route}, ${status}, ${db().json(body as never)})
    on conflict (partner_id, idempotency_key) do nothing`.catch(() => {});
}

/**
 * Tells a partner something happened, and signs it so they can tell it was us.
 *
 * The signature is an HMAC over the raw body with the partner's own secret,
 * which is how a receiver distinguishes our webhook from anybody who learned
 * the URL. Recorded before it is sent, so a delivery that fails is a row
 * somebody can retry rather than an event that never existed.
 */
export async function emit(partnerId: string, kind: string, payload: Record<string, unknown>) {
  if (!dbConfigured) return;
  await migrate();
  const sql = db();
  const [ev] = await sql<{ id: string }[]>`
    insert into capx.partner_events (partner_id, kind, payload)
    values (${partnerId}::uuid, ${kind}, ${sql.json(payload as never)})
    returning id::text`;

  const [p] = await sql<{ webhook_url: string | null; webhook_secret: string | null }[]>`
    select webhook_url, webhook_secret from capx.partners where id = ${partnerId}::uuid`;
  if (!p?.webhook_url) return;

  const body = JSON.stringify({ id: ev.id, kind, created: new Date().toISOString(), data: payload });
  const signature = p.webhook_secret
    ? createHmac("sha256", p.webhook_secret).update(body).digest("hex")
    : "";

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8_000);
    const r = await fetch(p.webhook_url, {
      method: "POST", signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        "capx-event": kind,
        ...(signature ? { "capx-signature": `sha256=${signature}` } : {}),
      },
      body,
    }).finally(() => clearTimeout(timer));

    await sql`
      update capx.partner_events
         set delivered = ${r.ok}, attempts = attempts + 1,
             delivered_at = ${r.ok ? sql`now()` : null},
             last_error = ${r.ok ? null : `HTTP ${r.status}`}
       where id = ${ev.id}::uuid`;
  } catch (e) {
    await sql`
      update capx.partner_events
         set attempts = attempts + 1,
             last_error = ${e instanceof Error ? e.message.slice(0, 300) : "failed"}
       where id = ${ev.id}::uuid`.catch(() => {});
  }
}

/** Constant-time compare, for anything a caller supplies that we hold a copy of. */
export function sameSecret(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
