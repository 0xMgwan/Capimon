import "server-only";
import postgres from "postgres";

/**
 * Postgres for the custodial ledger.
 *
 * CAPIMON holds client balances for nTZS users, so this is a system of record
 * for other people's money — every write goes through an append-only entry
 * table rather than mutating a balance in place.
 *
 * Works with any Postgres connection string (Neon, Supabase, Vercel Postgres).
 * Absent DATABASE_URL, custodial features report "not configured" rather than
 * failing obscurely; self-custody trading is unaffected.
 */

const URL = process.env.DATABASE_URL ?? "";
export const dbConfigured = URL.length > 0;

let client: ReturnType<typeof postgres> | null = null;

export function db() {
  if (!dbConfigured) throw new Error("DATABASE_URL is not configured");
  if (!client) {
    client = postgres(URL, {
      max: 5,
      idle_timeout: 20,
      // Serverless platforms recycle connections aggressively.
      connect_timeout: 10,
      prepare: false,
    });
  }
  return client;
}

let migrated: Promise<void> | null = null;

/**
 * Schema is created on first use rather than through a migration runner, so a
 * fresh deployment is a connection string and nothing else.
 *
 * Money is stored as exact integers — micro-USDC (1e-6) and whole shillings —
 * never floats. Share quantities are numeric with the B20 token's 8 decimals.
 */
export async function migrate() {
  if (!migrated) {
    migrated = (async () => {
      const sql = db();
      await sql`
        create table if not exists users (
          id             uuid primary key default gen_random_uuid(),
          email          text not null unique,
          password_hash  text not null,
          name           text,
          phone          text,
          country        text not null default 'TZ',
          ntzs_user_id   text,
          kyc_status     text not null default 'none',
          created_at     timestamptz not null default now()
        )`;
      await sql`
        create table if not exists sessions (
          token       text primary key,
          user_id     uuid not null references users(id) on delete cascade,
          created_at  timestamptz not null default now(),
          expires_at  timestamptz not null
        )`;
      await sql`create index if not exists sessions_user_idx on sessions(user_id)`;
      await sql`
        create table if not exists ledger_entries (
          id           bigserial primary key,
          user_id      uuid not null references users(id) on delete cascade,
          kind         text not null,
          asset        text not null,
          amount       numeric(38,8) not null,
          ref          text,
          metadata     jsonb not null default '{}'::jsonb,
          created_at   timestamptz not null default now()
        )`;
      await sql`create index if not exists ledger_user_asset_idx on ledger_entries(user_id, asset)`;
      // One row per external reference makes every money-moving write idempotent.
      await sql`create unique index if not exists ledger_ref_idx on ledger_entries(ref) where ref is not null`;
      await sql`
        create table if not exists orders (
          id            uuid primary key default gen_random_uuid(),
          user_id       uuid not null references users(id) on delete cascade,
          side          text not null,
          symbol        text not null,
          usdc_amount   numeric(38,6),
          qty           numeric(38,8),
          status        text not null default 'pending',
          tx_hash       text,
          price         numeric(38,6),
          fee_usdc      numeric(38,6) not null default 0,
          error         text,
          created_at    timestamptz not null default now(),
          settled_at    timestamptz
        )`;
      await sql`create index if not exists orders_user_idx on orders(user_id, created_at desc)`;
    })().catch((e) => {
      migrated = null;
      throw e;
    });
  }
  return migrated;
}
