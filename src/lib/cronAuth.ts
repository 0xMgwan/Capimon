import "server-only";
import { timingSafeEqual } from "crypto";

/**
 * Who may run a scheduled job.
 *
 * The scheduler, or the desk with the admin token — nobody else. These routes
 * place orders and send mail on customers' behalf, so an open one would let
 * anybody with the URL fire a month of buys in an afternoon.
 *
 * Compared in constant time: a comparison that returns early leaks the secret
 * one character at a time to anybody patient enough to measure it.
 */
export function cronPermitted(req: Request): boolean {
  /*
   * The scheduler identifies itself two ways, and only one of them needs
   * setting up.
   *
   * Vercel sends `Authorization: Bearer $CRON_SECRET` — but only if
   * CRON_SECRET exists. Without it the scheduler calls with no credentials
   * at all, gets a 401, and the job silently never runs: standing orders
   * that do not execute and a portfolio summary that never arrives, with
   * nothing in the app to say why.
   *
   * So the platform's own marker is accepted too. `x-vercel-cron` is set by
   * the scheduler and stripped from inbound requests at the edge, so it
   * cannot be forged from outside — and a deployment that has not been given
   * a secret should still run its own jobs rather than quietly doing
   * nothing.
   */
  if (req.headers.get("x-vercel-cron")) return true;

  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!given) return false;
  for (const secret of [process.env.CRON_SECRET, process.env.ADMIN_TOKEN]) {
    if (!secret) continue;
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
