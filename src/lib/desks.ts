/**
 * Which routes are a desk rather than the website.
 *
 * `/admin` is CAPX's own operations panel and `/dse` is the exchange's
 * oversight portal. Neither is a place to be sold an account, and on both the
 * marketing chrome is actively wrong: a price tape across the top of a
 * supervisory portal shows Apple and NVIDIA to a reader who has just been
 * told the page contains no US security, and a live feed of somebody selling
 * NVDAc contradicts it outright.
 *
 * One list, because the rule was already written three times — in the nav, in
 * the footer and nowhere else — and the next desk added would have inherited
 * two of the three.
 */
const DESKS = ["/admin", "/dse"];

export const isDeskPath = (path: string | null | undefined): boolean =>
  !!path && DESKS.some((d) => path === d || path.startsWith(`${d}/`));
