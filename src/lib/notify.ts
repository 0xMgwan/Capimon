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
}) {
  try {
    await migrate();
    await db()`
      insert into capx.notifications (user_id, kind, title, body, ref)
      values (${input.userId}, ${input.kind}, ${input.title}, ${input.body ?? null}, ${input.ref ?? null})
      on conflict (ref) where ref is not null do nothing`;
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
                read_at: string | null; created_at: string }[]>`
    select id::text, kind, title, body, read_at, created_at
      from capx.notifications
     where user_id = ${userId}
     order by id desc
     limit ${limit}`;
}

export async function markAllRead(userId: string) {
  await migrate();
  await db()`update capx.notifications set read_at = now()
              where user_id = ${userId} and read_at is null`;
}
