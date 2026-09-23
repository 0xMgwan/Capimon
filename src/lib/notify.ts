import "server-only";
import { db, migrate } from "./db";

/**
 * Tells someone what happened to their money while they were not looking.
 *
 * Settlement, fills and payouts all complete on a cron or mid-request, so
 * without a record of them the only way to learn a deposit had landed was to
 * keep the page open and watch a number change. That is a poor thing to ask of
 * anyone, and worse when the number is their savings.
 *
 * Every notification carries a `ref` unique to the event, so a cron that runs
 * twice — or a settle triggered from two places at once — cannot deliver the
 * same news twice.
 */
export type NotifyKind = "deposit" | "trade" | "withdrawal" | "alert";

export async function notify(input: {
  userId: string;
  kind: NotifyKind;
  title: string;
  body?: string;
  ref?: string;
  /** The holding this concerns, when it concerns one. */
  asset?: string | null;
  /** Where tapping the push notification should land. */
  url?: string;
}) {
  try {
    await migrate();
    const rows = await db()`
      insert into capx.notifications (user_id, kind, title, body, ref, asset)
      values (${input.userId}, ${input.kind}, ${input.title}, ${input.body ?? null},
              ${input.ref ?? null}, ${input.asset ?? null})
      on conflict (ref) where ref is not null do nothing
      returning id`;

    /*
     * The same news, delivered rather than waited for.
     *
     * Only when a row was actually written: the ref conflict above is what
     * stops a cron running twice from telling somebody twice, and pushing
     * outside that guard would undo it. Awaited but never allowed to throw —
     * the catch below covers it, and a push service having a bad day must not
     * roll back a settled deposit.
     */
    if (rows.length) {
      const { pushToUser } = await import("./push");
      await pushToUser(input.userId, {
        title: input.title,
        body: input.body,
        url: input.url ?? (input.kind === "trade" ? "/portfolio" : "/portfolio"),
        tag: input.ref,
      });
    }
  } catch {
    /*
     * Never let telling someone about a thing break the thing. A failed
     * notification must not roll back a settled deposit or a filled order.
     */
  }
}

export async function listNotifications(userId: string, limit = 30) {
  await migrate();
  return db()<{ id: string; kind: string; title: string; body: string | null;
                asset: string | null; read_at: string | null; created_at: string }[]>`
    select id::text, kind, title, body, asset, read_at, created_at
      from capx.notifications
     where user_id = ${userId}
     -- Sort by the timestamp the list actually displays. Ordering by id sorts
     -- by when the row was written, which is not the same thing once anything
     -- backfills — a deposit settled late lands with a new id and an older
     -- date, and then sits above trades that happened after it.
     order by created_at desc, id desc
     limit ${limit}`;
}

/**
 * Empties the list.
 *
 * A real delete rather than a hidden flag: this is the customer's own record of
 * what happened to their money, and if they ask for it to be gone, keeping a
 * copy they cannot see is not what they asked for. The ledger and the order
 * history are untouched — those are the account's books, not its inbox.
 */
export async function clearNotifications(userId: string) {
  await migrate();
  await db()`delete from capx.notifications where user_id = ${userId}`;
}

export async function markAllRead(userId: string) {
  await migrate();
  await db()`update capx.notifications set read_at = now()
              where user_id = ${userId} and read_at is null`;
}
