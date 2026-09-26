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
          /* password | wallet — how this session was opened. A session opened
             by signing from a wallet ends when that wallet disconnects; one
             opened with a password is unaffected by any of that. */
          via         text not null default 'password',
          created_at  timestamptz not null default now(),
          expires_at  timestamptz not null
        )`;
      // Case-insensitive uniqueness: two people cannot hold the same handle in
      // different capitalisations.
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
      // One row per external reference makes every money-moving write idempotent.
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

      // What happened to someone's money while they were not looking. Settling
      // runs on a cron, so without this the only way to learn a deposit landed
      // was to keep the page open and watch a number change.
      await sql`
        create table if not exists capx.notifications (
          id          bigserial primary key,
          user_id     uuid not null references capx.users(id) on delete cascade,
          kind        text not null,
          title       text not null,
          body        text,
          /* Unique per event, so a cron that runs twice cannot notify twice. */
          ref         text,
          /* Where tapping this should land. Stored, not only pushed: a row in
             the bell that says something happened and then refuses to show it
             is a worse answer than no row. */
          url         text,
          /* The handle behind it, where a person caused it — so a mention can
             wear their face rather than a generic warning triangle. */
          actor       text,
          read_at     timestamptz,
          created_at  timestamptz not null default now()
        )`;

      /*
       * Tokenised securities: a custody attestation, and the tokens issued
       * against it.
       *
       * Kept apart from `deposits` and `orders` on purpose. Those describe
       * CAPX holding money for a customer; these describe a claim on a share
       * somebody else is holding in a vault, and conflating the two would make
       * the backing question impossible to answer cleanly.
       */
      await sql`
        create table if not exists capx.custody_attestations (
          id           uuid primary key default gen_random_uuid(),
          security     text not null,
          custodian    text not null,
          quantity     numeric(38,8) not null,
          locked       numeric(38,8) not null,
          doc_ref      text,
          /* Evidence goes stale: a statement from six months ago does not say
             the shares are there today. */
          issued_at    timestamptz not null default now(),
          expires_at   timestamptz not null,
          status       text not null default 'pending',
          approved_by  text,
          approved_at  timestamptz,
          /* Signature and signer, empty until a custodian signs its own
             attestations. The column exists now so that day needs no migration. */
          signature    text,
          signer       text,
          metadata     jsonb not null default '{}'::jsonb,
          created_at   timestamptz not null default now()
        )`;

      await sql`
        create table if not exists capx.securities (
          symbol        text primary key,
          name          text not null,
          token_address text,
          decimals      int not null default 2,
          chain_id      int not null default 84532,
          status        text not null default 'draft',
          metadata      jsonb not null default '{}'::jsonb,
          created_at    timestamptz not null default now()
        )`;

      // Every mint and burn, so issuance is auditable end to end (Rule 10).
      await sql`
        create table if not exists capx.issuance_events (
          id             uuid primary key default gen_random_uuid(),
          security       text not null,
          kind           text not null,        -- mint | burn
          quantity       numeric(38,8) not null,
          attestation_id uuid references capx.custody_attestations(id),
          tx_hash        text,
          actor          text,
          created_at     timestamptz not null default now()
        )`;

      /*
       * A request to create or retire tokens, separate from the issuance log.
       *
       * The log records what happened on-chain; this records what somebody
       * asked for and who agreed to it. FIMCO can ask, CAPX approves, and the
       * issuer key executes — three parties, so no single one can both claim
       * shares exist and create tokens against them.
       */
      await sql`
        create table if not exists capx.issuance_requests (
          id           uuid primary key default gen_random_uuid(),
          security     text not null,
          kind         text not null,           -- mint | burn
          quantity     numeric(38,8) not null,
          note         text,
          requested_by text not null,
          status       text not null default 'pending',  -- pending | approved | executed | rejected
          decided_by   text,
          decided_at   timestamptz,
          tx_hash      text,
          executed_at  timestamptz,
          created_at   timestamptz not null default now()
        )`;

      /*
       * The last good price history per DSE security.
       *
       * The exchange's server goes down from time to time, and every chart
       * went blank with it. Each successful fetch is kept here and served when
       * the exchange cannot be reached, marked with when it was fetched.
       */
      await sql`
        create table if not exists capx.price_history_cache (
          symbol     text primary key,
          candles    jsonb not null,
          fetched_at timestamptz not null default now()
        )`;

      /*
       * Every price the oracle has published, read back from its events.
       *
       * The chart's last line of defence when the exchange is down: CAPX's own
       * published prices are permanent on-chain, so a history can always be
       * drawn from them. `sync_cursors` records how far the reading has got.
       */
      await sql`
        create table if not exists capx.oracle_points (
          symbol     text not null,
          price      numeric(38,8) not null,
          at         timestamptz not null,
          block      bigint not null,
          source     text,
          primary key (symbol, at)
        )`;
      await sql`
        /*
         * Standing orders: buy this much of this share, this often.
         *
         * The schedule is a next-run timestamp rather than a cron expression,
         * because the question the worker asks is "what is due now" and a
         * timestamp answers it with an index instead of a parse. Advancing it
         * is the worker's own job, so a run that fails does not silently skip
         * a month.
         */
        create table if not exists capx.recurring_buys (
          id          uuid primary key default gen_random_uuid(),
          user_id     uuid not null references capx.users(id) on delete cascade,
          symbol      text not null,
          amount_tzs  numeric(38,2) not null,
          /* weekly | monthly */
          cadence     text not null,
          /* 0–6 for weekly, 1–28 for monthly. Capped at 28 so every month has one. */
          day_of      int not null,
          next_run    timestamptz not null,
          /* active | paused */
          status      text not null default 'active',
          last_run_at timestamptz,
          last_error  text,
          runs        int not null default 0,
          misses      int not null default 0,
          created_at  timestamptz not null default now()
        )`;

      await sql`
        /*
         * Where to push a notification for a customer.
         *
         * One row per browser, not per person: somebody with a phone and a
         * laptop has two, and a subscription belongs to the installation
         * rather than the account. The endpoint is the identity — the browser
         * reissues it when it expires, and the old one simply stops working,
         * which is why a 404 or 410 from the push service deletes the row.
         */
        create table if not exists capx.push_subscriptions (
          endpoint   text primary key,
          user_id    uuid not null references capx.users(id) on delete cascade,
          p256dh     text not null,
          auth       text not null,
          user_agent text,
          created_at timestamptz not null default now(),
          last_sent_at timestamptz,
          failures   int not null default 0
        )`;

      await sql`
        /*
         * The broker's account with CAPX.
         *
         * Every shilling trade charges a fee and part of it is the broker's —
         * they hold the shares and carry the regulated relationship with the
         * exchange. That share is not a number computed for a dashboard: it is
         * money owed, so it is an append-only ledger like the customers' one,
         * with earnings positive and payouts negative and a balance that is
         * their sum. Nothing is ever edited; a correction is another row.
         *
         * The shillings themselves sit in the omnibus until a payout is made,
         * exactly as the customers' do.
         */
        create table if not exists capx.broker_ledger (
          id         uuid primary key default gen_random_uuid(),
          party      text not null default 'fimco',
          /* fee | payout | adjustment */
          kind       text not null,
          amount_tzs numeric(38,2) not null,
          security   text,
          order_id   uuid,
          /* Unique per event, so a replayed trade cannot pay twice. */
          ref        text,
          note       text,
          created_by text,
          created_at timestamptz not null default now()
        )`;

      await sql`
        /*
         * When each scheduled job last ran, and what it did.
         *
         * A cron that is not firing looks exactly like a cron that is firing
         * and finding nothing to do — standing orders that never execute and
         * a portfolio summary that never arrives are the same silence. One
         * row per job, overwritten each run, so the desk can say "last ran at
         * 09:00, bought two" instead of leaving somebody to guess.
         */
        /*
         * What customers say to each other on a market page.
         *
         * Kept per security rather than globally: a conversation about CRDB
         * belongs beside CRDB's price, and a single firehose would be a
         * different product. Deletion is a timestamp, not a removal — a
         * comment somebody replied to cannot simply vanish, and a moderator
         * needs to see what was said.
         */
        create table if not exists capx.comments (
          id         uuid primary key default gen_random_uuid(),
          symbol     text not null,
          user_id    uuid not null references capx.users(id) on delete cascade,
          body       text not null,
          /* Handles named with @, stored so a mention survives a later
             username change and can be highlighted without re-parsing. */
          mentions   jsonb not null default '[]'::jsonb,
          /* What this is a reply to. One level: a thread of threads is a
             different product, and a flat list of replies under a comment is
             what a conversation about a share actually looks like. */
          parent_id  uuid references capx.comments(id) on delete cascade,
          deleted_at timestamptz,
          created_at timestamptz not null default now()
        )`;

      await sql`
        /*
         * An external wallet, bound to a verified CAPX account.
         *
         * This is where the KYC perimeter reaches self-custody. CAPX will only
         * ever send a tokenised share to an address that appears here against
         * an approved account, so "who did we sell to" has the same answer for
         * a MetaMask buyer as it does for a custodial one.
         *
         * The binding is proved by a signature over a nonce we issued, so an
         * address cannot be claimed by someone who does not hold its key.
         * One address belongs to one account: linking it elsewhere would make
         * the KYC record ambiguous at exactly the moment it matters.
         */
        create table if not exists capx.wallet_links (
          id          uuid primary key default gen_random_uuid(),
          user_id     uuid not null references capx.users(id) on delete cascade,
          address     text not null,
          /* The challenge most recently issued for this address. */
          nonce       text,
          nonce_at    timestamptz,
          verified_at timestamptz,
          revoked_at  timestamptz,
          created_at  timestamptz not null default now()
        )`;

      await sql`
        /*
         * A share sold to, or bought back from, somebody's own wallet.
         *
         * CAPX is the counterparty: there is no pool in these securities and
         * does not need to be. The price is the DSE close the oracle carries,
         * converted at the nTZS rate — the same two numbers the custodial
         * ticket uses, so a share cannot cost one thing in the app and another
         * on-chain.
         *
         * Money moves in two legs and they are deliberately not simultaneous:
         * the customer pays first, from the address they verified, and CAPX
         * sends only against a mined receipt it has read itself. The funding
         * hash is unique in this table, so a receipt replayed twice settles once.
         */
        create table if not exists capx.otc_orders (
          id           uuid primary key default gen_random_uuid(),
          reference    text not null,
          user_id      uuid not null references capx.users(id) on delete cascade,
          address      text not null,
          security     text not null,
          side         text not null,
          /* Shares, and the two numbers that priced them, kept so a fill can
             be explained months later without re-deriving anything. */
          qty          numeric not null,
          price_tzs    numeric not null,
          usd_per_tzs  numeric not null,
          gross_usdc   numeric not null,
          fee_usdc     numeric not null,
          /* What the customer actually pays, or is actually paid. */
          net_usdc     numeric not null,
          status       text not null default 'quoted',
          funding_tx   text,
          settle_tx    text,
          failure      text,
          expires_at   timestamptz not null,
          settled_at   timestamptz,
          created_at   timestamptz not null default now()
        )`;

      await sql`
        /*
         * A one-time ticket to set a new password.
         *
         * The token itself is never stored — only its SHA-256 — so a leaked
         * copy of this table cannot be used to take an account. It is spent
         * on first use and dies an hour after it was issued, whichever comes
         * first, and setting a password ends every other session on the
         * account: if somebody reset it because they were locked out by
         * another person, leaving that person signed in defeats the point.
         */
        create table if not exists capx.password_resets (
          id         uuid primary key default gen_random_uuid(),
          user_id    uuid not null references capx.users(id) on delete cascade,
          token_hash text not null,
          expires_at timestamptz not null,
          used_at    timestamptz,
          created_at timestamptz not null default now()
        )`;

      await sql`
        create table if not exists capx.job_runs (
          job        text primary key,
          ran_at     timestamptz not null default now(),
          ok         boolean not null default true,
          detail     jsonb not null default '{}'::jsonb
        )`;

      await sql`
        create table if not exists capx.ops_contacts (
          /* Which party these addresses belong to: "fimco" today. */
          party      text primary key,
          /* Addresses, in the order they were entered. */
          emails     jsonb not null default '[]'::jsonb,
          updated_at timestamptz not null default now(),
          updated_by text
        )`;

      await sql`
        create table if not exists capx.sync_cursors (
          name  text primary key,
          block bigint not null,
          updated_at timestamptz not null default now()
        )`;

      // Reference prices, each with where it came from and when. A price with
      // no provenance is a number somebody typed, and settlement decides what a
      // share is worth (Rule 7).
      await sql`
        create table if not exists capx.oracle_prices (
          symbol      text primary key,
          price_tzs   numeric(38,8) not null,
          source      text not null,
          updated_at  timestamptz not null default now()
        )`;

      /*
       * Identity checks.
       *
       * The images live in the database rather than object storage because
       * there is no bucket configured and adding one would mean another
       * credential to lose; at this volume a few megabytes of bytea is the
       * smaller risk. They are never served without the admin token, and the
       * column they sit in is the reason the review route reads them one at a
       * time rather than selecting the whole row.
       *
       * A submission is kept after review rather than deleted, because the
       * evidence for a decision has to outlive the decision. That also means
       * this table holds identity documents: it is the one place in the schema
       * where a retention policy is a real obligation rather than tidiness.
       */
      await sql`
        create table if not exists capx.kyc_submissions (
          id            uuid primary key default gen_random_uuid(),
          user_id       uuid not null references capx.users(id) on delete cascade,
          doc_type      text not null,
          doc_number    text,
          doc_image     bytea not null,
          doc_mime      text not null,
          selfie_image  bytea not null,
          selfie_mime   text not null,
          status        text not null default 'pending',
          reason        text,
          reviewed_by   text,
          reviewed_at   timestamptz,
          created_at    timestamptz not null default now()
        )`;

      /*
       * Fees moved out of the omnibus.
       *
       * Fees are charged inside a trade and stay where the trade left them, so
       * without a record of what has been taken out, "how much is still owed to
       * the business" is the difference between two things that are never
       * written down together. A sweep is recorded before the transfer is
       * attempted and marked after, so a crash mid-flight leaves a row to
       * reconcile rather than money moved with nothing to show for it.
       */
      await sql`
        create table if not exists capx.fee_sweeps (
          id           bigserial primary key,
          amount_tzs   numeric(38,2) not null,
          destination  text not null,
          status       text not null default 'pending',
          transfer_id  text,
          tx_hash      text,
          error        text,
          created_at   timestamptz not null default now(),
          settled_at   timestamptz
        )`;

      /*
       * Columns added after a table first shipped.
       *
       * `create table if not exists` is a no-op on an existing table, so a new
       * column in the definition above never reaches a database that already
       * has the table. Every late addition has to be listed here as well —
       * missing one surfaces as a runtime "column does not exist" on the write
       * path, which is the worst place to find it.
       *
       * These run before any index is created, because an index over a
       * late-added column cannot exist before the column does — getting that
       * order wrong aborts the whole migration and leaves the column missing.
       */
      const lateColumns: Record<string, string[]> = {
        users: [
          /*
           * Whether this account's trading is public.
           *
           * Off until somebody turns it on. A customer's positions and
           * returns are among the most sensitive things here, and nobody who
           * signed up before there was a leaderboard agreed to appear on one.
           */
          "share_activity boolean not null default false",
          /* When the account holder agreed to the terms. Null for accounts
             opened before there were any, which is a fact worth keeping rather
             than back-filling with a date nobody chose. */
          "terms_accepted_at timestamptz",
          /* Which document the number in `nida_number` belongs to. The column
             is named for the one Tanzanians mostly carry, but a passport or a
             licence is just as valid and storing one under a NIDA label made
             the record say something untrue. */
          "doc_type text",
          "nida_number text",
          "is_admin boolean not null default false",
          "username text",
          // Small, resized data URL rather than a blob store: an avatar is a
          // few kilobytes and adding object storage for it would be a whole
          // dependency for one field.
          "avatar text",
        ],
        deposits: [
          "ntzs_status text", "ntzs_reference text", "swap_ref text", "transfer_tx text",
          "rate_tzs_usdc numeric(38,8)", "metadata jsonb not null default '{}'::jsonb",
        ],
        fee_sweeps: [
          /* Which side of the split this leg moved: capx | fimco. Older rows
             predate the split and are all CAPX's, which the default says. */
          "party text not null default 'capx'",
        ],
        ops_contacts: [
          /*
           * Where a counterparty's money is paid. Theirs to set, because the
           * account a payment lands in is not something we should be typing
           * on their behalf — and CAPX decides when it moves, not where.
           */
          "payout jsonb",
        ],
        custody_attestations: [
          /* Who filed it, as distinct from who it names as custodian. */
          "filed_by text",
          /* The evidence itself — a pledge of shares or a holding statement —
             as a data URL, the way KYC documents are kept. A reference number
             says a document exists; this is the document. Never selected by
             the listing queries: it is hundreds of kilobytes and is served on
             its own route. */
          "document text", "document_name text",
        ],
        sessions: [
          /* Added once a wallet could open one. */
          "via text not null default 'password'",
        ],
        comments: [
          /* Replies arrived after the table did. */
          "parent_id uuid references capx.comments(id) on delete cascade",
        ],
        notifications: [
          /* Which holding a trade notification concerns, so the row can show
             the company rather than a generic arrow. Null on deposits and
             withdrawals, which are about money rather than a share. */
          "asset text",
          /* Where tapping the row should go. It was only ever passed to the
             push payload, so the same event opened the right page from a
             phone's lock screen and nothing at all from inside the app. */
          "url text",
          /* Who did it, where a person did. A mention wearing the sender's
             face is recognisable before the sentence is read. */
          "actor text",
        ],
      };
      for (const [table, columns] of Object.entries(lateColumns)) {
        for (const col of columns) {
          await sql.unsafe(`alter table capx.${table} add column if not exists ${col}`);
        }
      }

      /*
       * Mentions that predate the columns above.
       *
       * They were written as generic alerts with nowhere to go and nobody
       * attached, so in the bell they are a hazard triangle that does not
       * open. The handle is recoverable from the title CAPX wrote and the
       * destination from the security, so they are repaired rather than left
       * as a pocket of rows that behave differently from every later one.
       *
       * Idempotent by the `actor is null` guard: once repaired, no row
       * matches again.
       */
      await sql`
        update capx.notifications
           set kind  = 'mention',
               actor = substring(title from '^@([A-Za-z0-9._-]+) '),
               url   = case when asset is not null
                            then '/markets/' || lower(asset) || '#comments'
                            else url end
         where kind = 'alert'
           and actor is null
           and title like '@%% mentioned you'
           and substring(title from '^@([A-Za-z0-9._-]+) ') is not null`;

      // Indexes last: every column they reference exists by now.
      await sql`create index if not exists sessions_user_idx on capx.sessions(user_id)`;
      await sql`create unique index if not exists users_username_idx
                  on capx.users (lower(username)) where username is not null`;
      await sql`create index if not exists ledger_user_asset_idx on capx.ledger_entries(user_id, asset)`;
      await sql`create unique index if not exists ledger_ref_idx on capx.ledger_entries(ref) where ref is not null`;
      await sql`create index if not exists notif_user_idx on capx.notifications(user_id, id desc)`;
      await sql`create unique index if not exists notif_ref_idx on capx.notifications(ref) where ref is not null`;
      await sql`create unique index if not exists broker_ledger_ref_idx
                  on capx.broker_ledger(ref) where ref is not null`;
      await sql`create index if not exists broker_ledger_party_idx
                  on capx.broker_ledger(party, created_at desc)`;
      await sql`create index if not exists push_user_idx on capx.push_subscriptions(user_id)`;
      await sql`create index if not exists recurring_due_idx
                  on capx.recurring_buys(next_run) where status = 'active'`;
      await sql`create index if not exists recurring_user_idx on capx.recurring_buys(user_id, created_at desc)`;
      await sql`create index if not exists custody_sec_idx on capx.custody_attestations(security, created_at desc)`;
      await sql`create index if not exists issuance_sec_idx on capx.issuance_events(security, created_at desc)`;
      await sql`create index if not exists fee_sweeps_status_idx on capx.fee_sweeps(status, created_at desc)`;
      await sql`create index if not exists kyc_user_idx on capx.kyc_submissions(user_id, created_at desc)`;
      await sql`create index if not exists kyc_status_idx on capx.kyc_submissions(status, created_at desc)`;
      await sql`create index if not exists orders_user_idx on capx.orders(user_id, created_at desc)`;
      await sql`create index if not exists deposits_user_idx on capx.deposits(user_id, created_at desc)`;
      await sql`create index if not exists comments_symbol_idx
                  on capx.comments(symbol, created_at desc)`;
      await sql`create index if not exists comments_user_idx on capx.comments(user_id)`;
      await sql`create index if not exists comments_parent_idx
                  on capx.comments(parent_id, created_at) where parent_id is not null`;
      await sql`create unique index if not exists wallet_links_address_idx
                  on capx.wallet_links (lower(address)) where revoked_at is null`;
      await sql`create index if not exists wallet_links_user_idx on capx.wallet_links(user_id)`;
      await sql`create unique index if not exists otc_reference_idx on capx.otc_orders(reference)`;
      /* The replay guard: one funding receipt settles one order, ever. */
      await sql`create unique index if not exists otc_funding_idx
                  on capx.otc_orders (lower(funding_tx)) where funding_tx is not null`;
      await sql`create index if not exists otc_user_idx on capx.otc_orders(user_id, created_at desc)`;
      /* Read on every quote to work out what inventory is already spoken for. */
      await sql`create index if not exists otc_open_idx
                  on capx.otc_orders(security, status) where status in ('quoted', 'funded')`;
      await sql`create unique index if not exists password_resets_token_idx
                  on capx.password_resets(token_hash)`;
      await sql`create index if not exists password_resets_user_idx
                  on capx.password_resets(user_id, created_at desc)`;
      await sql`create index if not exists deposits_status_idx on capx.deposits(status)`;
      /* The duplicate check reads this on every settlement pass. */
      await sql`create index if not exists deposits_ntzs_ref_idx
                  on capx.deposits(ntzs_reference) where ntzs_reference is not null`;
    })().catch((e) => {
      migrated = null;
      throw e;
    });
  }
  return migrated;
}
