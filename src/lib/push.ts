import "server-only";
import webpush from "web-push";
import { db, dbConfigured, migrate } from "./db";

/**
 * Notifications that arrive when the app is closed.
 *
 * The bell in the header only tells you something happened once you have
 * already opened the app, which is the wrong way round for news about your
 * money: a deposit that landed, a standing order that could not run, a
 * position that moved. This is the same notification, delivered by the
 * browser.
 *
 * Web Push, not a native service. It works in Chrome on Android and — since
 * iOS 16.4 — in Safari, but only for a site the customer has added to their
 * Home Screen. That constraint is worth knowing rather than working around:
 * CAPX is already installable, and someone who has installed it is exactly
 * the person who wants to be told.
 *
 * Unconfigured, everything here is a no-op. A missing key must not break a
 * settlement that was trying to announce itself.
 */
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
/** VAPID wants a way to reach whoever is sending, for a push service to complain to. */
const subject = process.env.VAPID_SUBJECT ?? "mailto:refitanzania@gmail.com";

export const pushConfigured = !!publicKey && !!privateKey;

let ready = false;
function configure() {
  if (ready || !pushConfigured) return pushConfigured;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  ready = true;
  return true;
}

export type PushPayload = {
  title: string;
  body?: string;
  /** Where tapping it should land. */
  url?: string;
  /** Collapses an older notification about the same thing. */
  tag?: string;
};

/**
 * Sends to every browser this customer has subscribed.
 *
 * A subscription the push service has retired is deleted rather than retried:
 * 404 and 410 mean the browser is gone for good, and keeping the row would
 * mean failing the same send every morning forever.
 */
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!configure() || !dbConfigured) return 0;
  try {
    await migrate();
    const sql = db();
    const subs = await sql<{ endpoint: string; p256dh: string; auth: string }[]>`
      select endpoint, p256dh, auth from capx.push_subscriptions where user_id = ${userId}::uuid`;
    if (!subs.length) return 0;

    const body = JSON.stringify(payload);
    let sent = 0;

    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 86_400 },
        );
        sent++;
        await sql`update capx.push_subscriptions set last_sent_at = now(), failures = 0
                   where endpoint = ${s.endpoint}`;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await sql`delete from capx.push_subscriptions where endpoint = ${s.endpoint}`;
        } else {
          await sql`update capx.push_subscriptions set failures = failures + 1
                     where endpoint = ${s.endpoint}`;
        }
      }
    }));

    return sent;
  } catch {
    // Telling someone about a thing must never break the thing.
    return 0;
  }
}

export async function saveSubscription(userId: string, sub: {
  endpoint: string; keys: { p256dh: string; auth: string };
}, userAgent: string | null): Promise<void> {
  await migrate();
  await db()`
    insert into capx.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
    values (${sub.endpoint}, ${userId}::uuid, ${sub.keys.p256dh}, ${sub.keys.auth}, ${userAgent})
    on conflict (endpoint) do update
      set user_id = excluded.user_id, p256dh = excluded.p256dh,
          auth = excluded.auth, user_agent = excluded.user_agent, failures = 0`;
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await migrate();
  await db()`delete from capx.push_subscriptions where endpoint = ${endpoint}`;
}

export async function subscriptionCount(userId: string): Promise<number> {
  if (!dbConfigured) return 0;
  await migrate();
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int as n from capx.push_subscriptions where user_id = ${userId}::uuid`;
  return row?.n ?? 0;
}
