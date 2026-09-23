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
