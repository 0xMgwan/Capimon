import "server-only";
import { db, dbConfigured, migrate } from "./db";

/**
 * The part of CAPX where customers are visible to each other.
 *
 * One rule runs through all of it: what somebody is doing with their money is
 * theirs until they say otherwise. A handle on a comment is public because
 * writing one is a public act; a position, a return and a volume are not, and
 * appear only where their owner has switched them on. Every read here
 * enforces that in the query rather than in the page, because a page is one
 * refactor away from forgetting.
 */
export const MAX_COMMENT = 500;
/** Comments per hour per account. Enough to talk; not enough to flood. */
const RATE_PER_HOUR = 20;

export type Comment = {
  id: string;
  symbol: string;
  body: string;
  mentions: string[];
  createdAt: string;
  author: { username: string | null; name: string | null; avatar: string | null };
  mine?: boolean;
};

/** Handles named with @ in a comment, lowercased and deduplicated. */
export function parseMentions(body: string): string[] {
  const found = body.match(/@[a-z0-9._-]{3,20}/gi) ?? [];
  return [...new Set(found.map((m) => m.slice(1).toLowerCase()))].slice(0, 10);
}

export async function listComments(symbol: string, viewerId?: string): Promise<Comment[]> {
  if (!dbConfigured) return [];
  await migrate();
  const rows = await db()<{ id: string; symbol: string; body: string; mentions: string[];
                            created_at: string; username: string | null; name: string | null;
                            avatar: string | null; user_id: string }[]>`
    select c.id::text, c.symbol, c.body, c.mentions, c.created_at,
           u.username, u.name, u.avatar, c.user_id::text
      from capx.comments c join capx.users u on u.id = c.user_id
     where c.symbol = ${symbol.toUpperCase()} and c.deleted_at is null
     order by c.created_at desc
     limit 100`;

  return rows.map((r) => ({
    id: r.id, symbol: r.symbol, body: r.body,
    mentions: Array.isArray(r.mentions) ? r.mentions : [],
    createdAt: r.created_at,
    author: { username: r.username, name: r.name, avatar: r.avatar },
    mine: !!viewerId && r.user_id === viewerId,
  }));
}

export async function postComment(userId: string, symbol: string, body: string): Promise<Comment | { error: string }> {
  const text = body.trim().replace(/\s+\n/g, "\n").slice(0, MAX_COMMENT);
  if (text.length < 2) return { error: "Say something first." };

  await migrate();
  const sql = db();

  const [{ recent }] = await sql<{ recent: number }[]>`
    select count(*)::int as recent from capx.comments
     where user_id = ${userId}::uuid and created_at > now() - interval '1 hour'`;
  if (recent >= RATE_PER_HOUR) {
    return { error: "You have posted a lot in the last hour. Try again shortly." };
  }

  const mentions = parseMentions(text);
  const [row] = await sql<{ id: string; created_at: string }[]>`
    insert into capx.comments (symbol, user_id, body, mentions)
    values (${symbol.toUpperCase()}, ${userId}::uuid, ${text}, ${JSON.stringify(mentions)}::jsonb)
    returning id::text, created_at`;

  const [author] = await sql<{ username: string | null; name: string | null; avatar: string | null }[]>`
    select username, name, avatar from capx.users where id = ${userId}::uuid`;

  /*
   * Telling somebody they were named.
   *
   * Through the same notification path as a fill or a deposit, so it reaches
   * a phone rather than waiting to be discovered. Never to the author: being
   * told you mentioned yourself is noise.
   */
  if (mentions.length) {
    const { notify } = await import("./notify");
    const targets = await sql<{ id: string; username: string }[]>`
      select id::text, username from capx.users
       where lower(username) = any(${mentions}) and id <> ${userId}::uuid`;
    const who = author?.username ? `@${author.username}` : author?.name ?? "Someone";
    await Promise.all(targets.map((t) => notify({
      userId: t.id, kind: "alert", ref: `mention:${row.id}:${t.id}`, asset: symbol.toUpperCase(),
      title: `${who} mentioned you`,
      body: text.slice(0, 140),
      url: `/markets/${symbol.toLowerCase()}#comments`,
    })));
  }

  return {
    id: row.id, symbol: symbol.toUpperCase(), body: text, mentions,
    createdAt: row.created_at,
    author: { username: author?.username ?? null, name: author?.name ?? null, avatar: author?.avatar ?? null },
    mine: true,
  };
}

/** Only ever your own, and only ever a timestamp. */
export async function deleteComment(userId: string, id: string): Promise<boolean> {
  await migrate();
  const rows = await db()`
    update capx.comments set deleted_at = now()
     where id = ${id}::uuid and user_id = ${userId}::uuid and deleted_at is null
    returning id`;
  return rows.length > 0;
}

/** Handles for the @ autocomplete. A username is a chosen, public name. */
export async function searchHandles(q: string): Promise<{ username: string; name: string | null; avatar: string | null }[]> {
  const term = q.trim().toLowerCase().replace(/^@/, "");
  if (term.length < 1 || !dbConfigured) return [];
  await migrate();
  const rows = await db()<{ username: string; name: string | null; avatar: string | null }[]>`
    select username, name, avatar from capx.users
     where username is not null and lower(username) like ${term + "%"}
     order by username limit 6`;
  return rows;
}

export type PublicProfile = {
  username: string | null;
  name: string | null;
  avatar: string | null;
  joined: string;
  /** Null when this account has not published its trading. */
  activity: null | {
    trades: number;
    volumeTzs: number;
    realisedTzs: number;
    unrealisedTzs: number;
    holdings: { symbol: string; qty: number }[];
  };
};

/**
 * A customer as other customers may see them.
 *
 * The name and the handle are always here — they are how a comment is
 * attributed. Everything about money is behind the account's own switch, and
 * the switch is checked here rather than by the caller.
 */
export async function publicProfile(username: string): Promise<PublicProfile | null> {
  if (!dbConfigured) return null;
  await migrate();
  const sql = db();

  const [u] = await sql<{ id: string; username: string | null; name: string | null;
                          avatar: string | null; created_at: string; share_activity: boolean }[]>`
    select id::text, username, name, avatar, created_at, share_activity
      from capx.users where lower(username) = ${username.trim().toLowerCase().replace(/^@/, "")}`;
  if (!u) return null;

  const base = { username: u.username, name: u.name, avatar: u.avatar, joined: u.created_at };
  if (!u.share_activity) return { ...base, activity: null };

  const [{ trades, volume }] = await sql<{ trades: number; volume: string }[]>`
    select count(*)::int as trades,
           coalesce(sum(abs(qty * price)), 0)::text as volume
      from capx.orders where user_id = ${u.id}::uuid and status = 'settled'`;

  const { positionCosts } = await import("./pnl");
  const costs = await positionCosts(u.id).catch(() => new Map());
  const realised = [...costs.values()].reduce((sum, c) => sum + (c.currency === "TZS" ? c.realised : 0), 0);

  const holdings = await sql<{ asset: string; qty: string }[]>`
    select asset, sum(amount)::text as qty from capx.ledger_entries
     where user_id = ${u.id}::uuid and asset <> 'TZS' and asset <> 'USDC'
     group by asset having sum(amount) > 0.001 order by asset`;

  return {
    ...base,
    activity: {
      trades,
      volumeTzs: Number(volume),
      realisedTzs: realised,
      unrealisedTzs: 0,
      holdings: holdings.map((h) => ({ symbol: h.asset, qty: Number(h.qty) })),
    },
  };
}

export type LeaderRow = {
  username: string;
  name: string | null;
  avatar: string | null;
  trades: number;
  volumeTzs: number;
  realisedTzs: number;
};

/**
 * Ranked by what people chose to publish.
 *
 * Accounts that have not switched their trading on are not here at all — not
 * hidden, not anonymised, absent. A leaderboard that quietly includes people
 * who never agreed to be ranked is not a leaderboard, it is a disclosure.
 */
export async function leaderboard(by: "volume" | "realised" = "volume"): Promise<LeaderRow[]> {
  if (!dbConfigured) return [];
  await migrate();
  const sql = db();

  const rows = await sql<{ id: string; username: string; name: string | null; avatar: string | null;
                           trades: number; volume: string }[]>`
    select u.id::text, u.username, u.name, u.avatar,
           count(o.id)::int as trades,
           coalesce(sum(abs(o.qty * o.price)), 0)::text as volume
      from capx.users u
      left join capx.orders o on o.user_id = u.id and o.status = 'settled'
     where u.share_activity = true and u.username is not null
     group by u.id, u.username, u.name, u.avatar
    having count(o.id) > 0
     order by sum(abs(o.qty * o.price)) desc nulls last
     limit 50`;

  const { positionCosts } = await import("./pnl");
  const out = await Promise.all(rows.map(async (r) => {
    const costs = await positionCosts(r.id).catch(() => new Map());
    const realised = [...costs.values()].reduce((s, c) => s + (c.currency === "TZS" ? c.realised : 0), 0);
    return {
      username: r.username, name: r.name, avatar: r.avatar,
      trades: r.trades, volumeTzs: Number(r.volume), realisedTzs: realised,
    };
  }));

  return by === "realised"
    ? out.sort((a, b) => b.realisedTzs - a.realisedTzs)
    : out;
}
