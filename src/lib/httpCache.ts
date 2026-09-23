/**
 * Cache headers for the endpoints that answer everybody the same way.
 *
 * Prices, listings and venues do not depend on who is asking, and every one
 * of them was `no-store` — so each visitor's poll was its own function
 * invocation, and a page left open in a tab was a few thousand of them a day
 * on its own. With these the CDN answers instead, and a hundred readers cost
 * what one costs.
 *
 * `stale-while-revalidate` is the important half: past the fresh window the
 * cached answer is still served immediately while a single request refreshes
 * it behind the scenes, so nobody waits and the origin is hit once rather
 * than once per reader.
 *
 * Never used on anything per-account. A shared cache in front of a customer's
 * balance would serve one person's money to another, which is the one bug
 * worth more than every invocation this saves.
 */
export function publicCache(seconds: number, staleSeconds = Math.max(60, seconds * 6)) {
  return {
    "cache-control": `public, s-maxage=${seconds}, stale-while-revalidate=${staleSeconds}`,
    /* Only the shared cache is allowed to hold it: a browser that cached the
       same answer would keep showing an old price after a reload, which is
       the one place people expect a fresh number. */
    "cdn-cache-control": `public, s-maxage=${seconds}, stale-while-revalidate=${staleSeconds}`,
  };
}
