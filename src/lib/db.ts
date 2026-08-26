import "server-only";
import postgres from "postgres";

/**
 * Postgres for the custodial ledger.
 *
 * CAPX holds client balances for nTZS users, so this is a system of record
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
      // Everything lives in its own schema so CAPX can share a database with
      // anything else without either side colliding.
      //
      // Deployments created before the rename still hold a `capimon` schema with
      // live rows in it. Move it rather than creating an empty one beside it —
      // an orphaned schema would read as a wiped ledger.
      const [legacy] = await sql<{ exists: boolean }[]>`
        select
          exists(select 1 from information_schema.schemata where schema_name = 'capimon')
          and not exists(select 1 from information_schema.schemata where schema_name = 'capx')
          as exists`;
      if (legacy?.exists) await sql`alter schema capimon rename to capx`;
      await sql`create schema if not exists capx`;
      await sql`
        create table if not exists capx.users (
          id             uuid primary key default gen_random_uuid(),
          email          text not null unique,
          password_hash  text not null,
          name           text,
          phone          text,
          country        text not null default 'TZ',
          ntzs_user_id   text,
          nida_number    text,
          is_admin       boolean not null default false,
          kyc_status     text not null default 'none',
          created_at     timestamptz not null default now()
        )`;
      await sql`
        create table if not exists capx.sessions (
          token       text primary key,
          user_id     uuid not null references capx.users(id) on delete cascade,
          created_at  timestamptz not null default now(),
          expires_at  timestamptz not null
        )`;
      await sql`create index if not exists sessions_user_idx on capx.sessions(user_id)`;
      // Case-insensitive uniqueness: two people cannot hold the same handle in
      // different capitalisations.
      await sql`create unique index if not exists users_username_idx
                  on capx.users (lower(username)) where username is not null`;
      await sql`
        create table if not exists capx.ledger_entries (
          id           bigserial primary key,
          user_id      uuid not null references capx.users(id) on delete cascade,
          kind         text not null,
          asset        text not null,
          amount       numeric(38,8) not null,
          ref          text,
          metadata     jsonb not null default '{}'::jsonb,
          created_at   timestamptz not null default now()
        )`;
      await sql`create index if not exists ledger_user_asset_idx on capx.ledger_entries(user_id, asset)`;
      // One row per external reference makes every money-moving write idempotent.
      await sql`create unique index if not exists ledger_ref_idx on capx.ledger_entries(ref) where ref is not null`;
      await sql`
        create table if not exists capx.orders (
          id            uuid primary key default gen_random_uuid(),
          user_id       uuid not null references capx.users(id) on delete cascade,
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
      await sql`create index if not exists orders_user_idx on capx.orders(user_id, created_at desc)`;
      // Deposits land in one omnibus nTZS wallet, so the only record of who sent
      // what is this table. It is the attribution, and it is written before the
      // money is asked for.
      await sql`
        create table if not exists capx.deposits (
          id             uuid primary key default gen_random_uuid(),
          user_id        uuid not null references capx.users(id) on delete cascade,
          ntzs_deposit_id text unique,
          amount_tzs     integer not null,
          phone          text not null,
          status         text not null default 'pending',
          usdc_credited  numeric(38,6),
          error          text,
          -- Reconciliation trail: every upstream reference this deposit touched,
          -- so a row can be matched against nTZS without guesswork.
          ntzs_status    text,
          ntzs_reference text,
          swap_ref       text,
          transfer_tx    text,
          rate_tzs_usdc  numeric(38,8),
          metadata       jsonb not null default '{}'::jsonb,
          created_at     timestamptz not null default now(),
          settled_at     timestamptz
        )`;
      await sql`create index if not exists deposits_user_idx on capx.deposits(user_id, created_at desc)`;
      await sql`create index if not exists deposits_status_idx on capx.deposits(status)`;

      /*
       * Columns added after a table first shipped.
       *
       * `create table if not exists` is a no-op on an existing table, so a new
       * column in the definition above never reaches a database that already
       * has the table. Every late addition has to be listed here as well —
       * missing one surfaces as a runtime "column does not exist" on the write
       * path, which is the worst place to find it.
       */
      const lateColumns: Record<string, string[]> = {
        users: [
          "nida_number text",
          "is_admin boolean not null default false",
          "username text",
        ],
        deposits: [
          "ntzs_status text", "ntzs_reference text", "swap_ref text", "transfer_tx text",
          "rate_tzs_usdc numeric(38,8)", "metadata jsonb not null default '{}'::jsonb",
        ],
      };
      for (const [table, columns] of Object.entries(lateColumns)) {
        for (const col of columns) {
          await sql.unsafe(`alter table capx.${table} add column if not exists ${col}`);
        }
      }
    })().catch((e) => {
      migrated = null;
      throw e;
    });
  }
  return migrated;
}
