import "server-only";
import { db, dbConfigured, migrate } from "./db";
import { getMarkets } from "./markets";
import { dseSecurities } from "./dseSecurities";
import { readOraclePrice } from "./oracle";
import { pushToUser } from "./push";

/**
 * A short account of what somebody's holdings did, morning and evening.
 *
 * The argument for it is that a portfolio nobody looks at is a portfolio
 * nobody adds to. The argument against sending more than two is stronger: a
 * notification every time a price moves trains people to swipe them away, and
 * then the one that matters — a standing order that could not run — goes with
 * the rest. Twice a day, at times chosen around the market rather than around
 * us: before it opens and after it has closed.
 *
 * Valued in shillings, because that is what the people reading it earn and
 * think in. A holding CAPX cannot price is left out of the total rather than
 * counted as zero: a total that quietly omits something is better than one
 * that confidently understates it.
 */
export type DigestSlot = "morning" | "evening";

const DUST = 0.001;

type Holding = { userId: string; asset: string; qty: number };

/** Every customer holding something, in one query rather than one per user. */
async function holdings(): Promise<Holding[]> {
  const rows = await db()<{ user_id: string; asset: string; qty: string }[]>`
    select user_id::text, asset, sum(amount)::text as qty
      from capx.ledger_entries
     where asset <> 'USDC' and asset <> 'TZS'
     group by user_id, asset
    having abs(sum(amount)) >= ${DUST}`;
  return rows.map((r) => ({ userId: r.user_id, asset: r.asset, qty: Number(r.qty) }));
}

/** Shilling price and today's move for everything we might hold. */
async function marks(): Promise<Map<string, { tzs: number; changePct: number; name: string }>> {
  const out = new Map<string, { tzs: number; changePct: number; name: string }>();

  // Tanzanian shares are quoted in shillings already.
  const dse = await dseSecurities().catch(() => []);
  await Promise.all(dse.map(async (d) => {
    const p = await readOraclePrice(d.symbol).catch(() => null);
    if (p?.price) out.set(d.symbol, { tzs: p.price, changePct: 0, name: d.name });
  }));

  /*
   * US shares are quoted in dollars, so they need the shilling rate. It is
   * read once, from the same swap quote the rest of the app prices against —
   * a second source would let the digest disagree with the portfolio page.
   */
  try {
    const { ntzsConfigured, getSwapRate } = await import("./ntzs");
    const rate = ntzsConfigured
      ? await getSwapRate("NTZS", "USDC", 100_000)
          .then((r) => { const o = Number(r.expectedOutput ?? 0); return o > 0 ? o / 100_000 : 0; })
          .catch(() => 0)
      : 0;
    if (rate > 0) {
      const markets = await getMarkets({ depth: 1 });
      for (const m of markets) {
        if (m.price > 0) out.set(m.symbol, { tzs: m.price / rate, changePct: m.change ?? 0, name: m.name });
      }
    }
  } catch { /* the Tanzanian half still sends */ }

  return out;
}

const money = (n: number) => `${Math.round(n).toLocaleString()} TZS`;

/**
 * Sends the digest to everyone who holds something and has a device
 * subscribed.
 *
 * Nothing is sent to an empty portfolio. Somebody who has not bought anything
 * does not need telling twice a day that they have not bought anything.
 */
export async function sendDigest(slot: DigestSlot): Promise<{ users: number; sent: number }> {
  if (!dbConfigured) return { users: 0, sent: 0 };
  await migrate();

  const [rows, priced] = await Promise.all([holdings(), marks()]);
  if (!rows.length) return { users: 0, sent: 0 };

  const byUser = new Map<string, Holding[]>();
  for (const h of rows) {
    const list = byUser.get(h.userId) ?? [];
    list.push(h);
    byUser.set(h.userId, list);
  }

  let sent = 0;
  for (const [userId, list] of byUser) {
    let total = 0;
    let moved = 0;
    let best: { asset: string; pct: number } | null = null;

    for (const h of list) {
      const m = priced.get(h.asset);
      if (!m?.tzs) continue;            // unpriced: left out rather than zeroed
      const value = h.qty * m.tzs;
      total += value;
      moved += value * (m.changePct / 100);
      if (!best || Math.abs(m.changePct) > Math.abs(best.pct)) best = { asset: h.asset, pct: m.changePct };
    }

    if (total <= 0) continue;

    const pct = total > 0 ? (moved / total) * 100 : 0;
    const direction = moved > 0 ? "up" : moved < 0 ? "down" : "flat";

    const title = slot === "morning"
      ? `Good morning — ${money(total)}`
      : `Today's close — ${money(total)}`;

    const body = direction === "flat"
      ? (slot === "morning" ? "Your portfolio is unchanged since yesterday." : "Your portfolio finished the day unchanged.")
      : `${direction === "up" ? "Up" : "Down"} ${money(Math.abs(moved))} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`
        + (best && Math.abs(best.pct) >= 0.05
            ? ` · ${best.asset} ${best.pct >= 0 ? "+" : ""}${best.pct.toFixed(1)}%`
            : "");

    // A push, not a stored notification: a twice-daily summary in the bell
    // would bury the deposits and fills that people actually go looking for.
    sent += await pushToUser(userId, {
      title, body, url: "/portfolio",
      // One per slot per day, so a retry replaces rather than repeats.
      tag: `digest:${slot}:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  return { users: byUser.size, sent };
}
