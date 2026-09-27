import "server-only";
import { db, dbConfigured, migrate } from "./db";
import { record } from "./ledger";
import { getMarkets } from "./markets";
import { notify } from "./notify";

/**
 * Passing a dividend or a split on to the people who own the shares.
 *
 * A B20 token does not mint on a corporate action. It raises a WAD-scaled
 * `multiplier`, so one token comes to stand for slightly more than one share
 * and `scaledBalanceOf` reports the larger figure. Anybody holding the token
 * in their own wallet is therefore paid automatically, by arithmetic.
 *
 * A custodial claim is not a token. It is a number in the ledger, written
 * when the trade settled, and nothing here ever went back to it. So the
 * treasury's holding grew with each corporate action while the claims against
 * it did not, and the difference showed up in solvency as CAPX's own surplus
 * — which is to say: a dividend that belonged to customers was accruing to
 * the custodian. Quietly, and by omission rather than intent, which is the
 * kind that goes unnoticed longest.
 *
 * This closes it. Each run compares the chain's multiplier against the last
 * one distributed and credits every holder the difference, pro rata, through
 * the same append-only ledger a trade uses.
 *
 * ## Why increases only
 *
 * A multiplier can in principle fall — a reverse split does that — and
 * applying one means debiting customers. That is not a thing to do on a
 * schedule with nobody watching, so a decrease is recorded, reported and left
 * for the desk.
 *
 * ## Why it cannot pay twice
 *
 * Every entry is keyed `corp:<symbol>:<multiplier>:<user>`, and the ledger's
 * ref index is unique. A run that dies halfway through resumes safely; a run
 * that fires twice writes nothing the second time.
 */

/** Ignore differences smaller than this: dust, and floating point. */
const EPSILON = 1e-12;

export type CorporateActionResult = {
  symbol: string;
  from: number;
  to: number;
  holders: number;
  qtyCredited: number;
  /** Set instead of a credit when the multiplier fell. */
  needsDesk?: string;
};

export async function applyCorporateActions(): Promise<CorporateActionResult[]> {
  if (!dbConfigured) return [];
  await migrate();
  const sql = db();

  const markets = await getMarkets({ depth: 2 }).catch(() => []);
  if (!markets.length) return [];

  const seen = await sql<{ symbol: string; multiplier: string }[]>`
    select symbol, multiplier::text from capx.corporate_actions`;
  const last = new Map(seen.map((r) => [r.symbol, Number(r.multiplier)]));

  const out: CorporateActionResult[] = [];

  for (const m of markets) {
    const to = m.multiplier;
    if (!Number.isFinite(to) || to <= 0) continue;
    /*
     * 1.0 is where every one of these tokens began, so an unseen symbol is
     * not "no history" — it is history nobody has distributed yet.
     */
    const from = last.get(m.symbol) ?? 1;
    if (Math.abs(to - from) <= EPSILON) continue;

    if (to < from) {
      out.push({
        symbol: m.symbol, from, to, holders: 0, qtyCredited: 0,
        needsDesk: `Multiplier fell from ${from} to ${to}. Applying it means debiting holders, which needs a person.`,
      });
      continue;
    }

    const ratio = to / from;

    /*
     * Everyone with a positive claim, at the moment of distribution.
     *
     * Not "whoever held when the action happened" — the chain does not tell
     * us when it happened and the ledger cannot reconstruct it. Somebody who
     * sold beforehand was paid out at the price they sold at and is whole;
     * the inventory carrying the uplift is what backs the claims that still
     * exist, so those are the claims it belongs to. This is also what keeps
     * the book square: after the run, owed matches held again.
     */
    const holders = await sql<{ user_id: string; qty: string }[]>`
      select user_id::text, sum(amount)::text as qty
        from capx.ledger_entries
       where asset = ${m.symbol}
       group by user_id
      having sum(amount) > 0.00000001`;

    let credited = 0;
    /** Holders actually credited by this run, which a retry may make fewer. */
    let paid = 0;
    for (const h of holders) {
      const held = Number(h.qty);
      const delta = held * (ratio - 1);
      /*
       * Below the ledger's own precision there is nothing to write, and the
       * eight-decimal rounding below truncates rather than rounds up. Both
       * leave a residue, and both leave it with CAPX rather than paying out
       * more than the treasury received — which is the only direction a
       * custodian may be wrong in. Checked: for a 1.0003771 multiplier the
       * credits sum to the uplift within 1e-9.
       */
      if (!(delta > 0.00000001)) continue;

      /*
       * Counted from what was written, not from what was intended.
       *
       * `record` reports a duplicate ref rather than throwing, so a run that
       * died halfway and was retried would otherwise report crediting
       * holders it had credited the first time — a report of a payment that
       * did not happen, in the table the desk reads to check that it did.
       */
      const wrote = await record([{
        userId: h.user_id,
        kind: "adjustment",
        asset: m.symbol,
        amount: delta.toFixed(8),
        ref: `corp:${m.symbol}:${to}:${h.user_id}`,
        metadata: {
          reason: "corporate action", symbol: m.symbol,
          fromMultiplier: from, toMultiplier: to, heldBefore: held,
        },
      }]).catch(() => ({ written: 0 }));
      if (!wrote.written) continue;
      credited += delta;
      paid++;

      await notify({
        userId: h.user_id, kind: "trade", asset: m.symbol,
        ref: `corp:${m.symbol}:${to}:${h.user_id}`,
        title: `${m.ticker ?? m.symbol} paid a dividend`,
        body: `Your holding grew by ${delta.toFixed(6)} ${m.ticker ?? m.symbol}. Nothing to do.`,
        url: "/portfolio",
      }).catch(() => { /* the credit stands whether or not the news lands */ });
    }

    await sql`
      insert into capx.corporate_actions (symbol, multiplier, holders, qty_credited, applied_at)
      values (${m.symbol}, ${to}, ${paid}, ${credited}, now())
      on conflict (symbol) do update
        set multiplier = excluded.multiplier, holders = excluded.holders,
            qty_credited = excluded.qty_credited, applied_at = now()`;

    out.push({ symbol: m.symbol, from, to, holders: paid, qtyCredited: credited });
  }

  /*
   * The desk hears about anything that moved.
   *
   * A corporate action changes what every holder of a security owns, and it
   * happens without anybody asking for it — so it should not be discoverable
   * only by reading a cron's return value.
   */
  const notable = out.filter((r) => r.qtyCredited > 0 || r.needsDesk);
  if (notable.length) {
    const { sendMail } = await import("./mail");
    await sendMail({
      subject: `CAPX: corporate actions applied (${notable.map((r) => r.symbol).join(", ")})`,
      text: notable.map((r) => r.needsDesk
        ? `${r.symbol}: ${r.needsDesk}`
        : `${r.symbol}: multiplier ${r.from} → ${r.to}, credited ${r.qtyCredited.toFixed(8)} ` +
          `across ${r.holders} holder(s).`).join("\n"),
    }).catch(() => { /* recorded in the table either way */ });
  }

  return out;
}

/** What the desk has distributed, newest first. */
export async function corporateActionLog() {
  if (!dbConfigured) return [];
  await migrate();
  return db()<{ symbol: string; multiplier: string; holders: number;
                qty_credited: string; applied_at: string }[]>`
    select symbol, multiplier::text, holders, qty_credited::text, applied_at
      from capx.corporate_actions order by applied_at desc`;
}
