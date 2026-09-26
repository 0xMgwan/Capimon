import "server-only";
import { db, dbConfigured, migrate } from "./db";

/**
 * Everything that has happened to one customer's money, in one list.
 *
 * The record of it is spread across five tables because each is the right
 * shape for what writes to it — an order is not a deposit is not a transfer
 * out — and none of them is the shape a person asks the question in. What
 * somebody wants is "what happened, when, and did it work", in time order,
 * with the detail underneath when they ask for it.
 *
 * So this reads all five and merges them. It does not summarise: a receipt
 * that rounds, or omits the reference the bank will ask for, is a receipt
 * that has to be chased somewhere else. Every row carries whatever identifies
 * it upstream — an nTZS reference, a transaction hash, a quote id — because
 * the one time anybody reads this closely is when something has gone wrong.
 *
 * Nothing here is derived twice. Status is the status the writing table
 * recorded; amounts are the amounts it settled at. Where a figure is missing
 * it is absent rather than computed, because a number invented for a receipt
 * is worse than a gap.
 */

export type ActivityKind =
  | "buy" | "sell"
  | "deposit" | "withdrawal"
  | "self-buy" | "self-sell"
  | "adjustment";

/** pending | settled | failed — normalised across tables that spell it differently. */
export type ActivityStatus = "pending" | "settled" | "failed";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  at: string;
  /** Settlement time where it differs from when it was started. */
  settledAt: string | null;
  /** The security, for anything that concerns one. */
  asset: string | null;
  /** Shares, for a trade. */
  qty: number | null;
  /** The cash leg, in the currency it actually moved in. */
  amount: number | null;
  currency: "TZS" | "USDC" | null;
  price: number | null;
  fee: number | null;
  /** Why it failed, verbatim from whatever refused it. */
  error: string | null;
  /** Everything that identifies this upstream, for a receipt. */
  refs: { label: string; value: string; href?: string }[];
  /** A line of plain English, where the numbers alone do not say it. */
  note: string | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const basescan = (tx: string) => `https://basescan.org/tx/${tx}`;

/** Order and OTC tables agree on these words; deposits do not. */
const normaliseStatus = (s: string): ActivityStatus =>
  s === "settled" ? "settled"
  : s === "failed" || s === "duplicate" || s === "expired" ? "failed"
  : "pending";

export async function userActivity(userId: string, limit = 120): Promise<ActivityItem[]> {
  if (!dbConfigured) return [];
  await migrate();
  const sql = db();

  const [orders, deposits, otc, ledger] = await Promise.all([
    sql<{ id: string; side: string; symbol: string; usdc_amount: string | null; qty: string | null;
          status: string; tx_hash: string | null; price: string | null; fee_usdc: string;
          error: string | null; created_at: string; settled_at: string | null;
          metadata_tzs: string | null }[]>`
      select o.id::text, o.side, o.symbol, o.usdc_amount::text, o.qty::text, o.status,
             o.tx_hash, o.price::text, o.fee_usdc::text, o.error, o.created_at, o.settled_at,
             /*
              * The shilling leg, where there was one.
              *
              * A DSE order is placed in shillings and the ledger carries that
              * figure; the order row only ever knew the dollar side. Showing a
              * customer $0.79 for something they paid 2,000 TZS for is a
              * receipt for a transaction they did not recognise.
              */
             (select abs(l.amount)::text from capx.ledger_entries l
               where l.ref = o.id::text || ':cash' and l.asset = 'TZS' limit 1) as metadata_tzs
        from capx.orders o
       where o.user_id = ${userId}::uuid
       order by o.created_at desc limit ${limit}`,

    sql<{ id: string; amount_tzs: number; status: string; usdc_credited: string | null;
          ntzs_reference: string | null; ntzs_deposit_id: string | null; transfer_tx: string | null;
          rate_tzs_usdc: string | null; phone: string; error: string | null;
          created_at: string; settled_at: string | null }[]>`
      select id::text, amount_tzs, status, usdc_credited::text, ntzs_reference, ntzs_deposit_id,
             transfer_tx, rate_tzs_usdc::text, phone, error, created_at, settled_at
        from capx.deposits
       where user_id = ${userId}::uuid
       order by created_at desc limit ${limit}`,

    sql<{ reference: string; security: string; side: string; qty: string; net_usdc: string;
          fee_usdc: string; price_tzs: string; status: string; funding_tx: string | null;
          settle_tx: string | null; failure: string | null; address: string;
          created_at: string; settled_at: string | null }[]>`
      select reference, security, side, qty::text, net_usdc::text, fee_usdc::text, price_tzs::text,
             status, funding_tx, settle_tx, failure, address, created_at, settled_at
        from capx.otc_orders
       where user_id = ${userId}::uuid
       order by created_at desc limit ${limit}`,

    /*
     * Withdrawals and corrections have no table of their own — the ledger is
     * where they are recorded, and its metadata carries the destination and
     * the reason. Trades and deposits are excluded: they are above, with more
     * detail than an entry can hold.
     */
    sql<{ id: string; kind: string; asset: string; amount: string; ref: string | null;
          metadata: Record<string, unknown>; created_at: string }[]>`
      select id::text, kind, asset, amount::text, ref, metadata, created_at
        from capx.ledger_entries
       where user_id = ${userId}::uuid and kind in ('withdrawal', 'adjustment')
       order by created_at desc limit ${limit}`,
  ]);

  const items: ActivityItem[] = [];

  for (const o of orders) {
    const tzs = num(o.metadata_tzs);
    const refs: ActivityItem["refs"] = [{ label: "Order", value: o.id }];
    if (o.tx_hash) refs.push({ label: "Transaction", value: o.tx_hash, href: basescan(o.tx_hash) });
    items.push({
      id: `order:${o.id}`,
      kind: o.side === "sell" ? "sell" : "buy",
      status: normaliseStatus(o.status),
      at: o.created_at,
      settledAt: o.settled_at,
      asset: o.symbol,
      qty: num(o.qty),
      amount: tzs ?? num(o.usdc_amount),
      currency: tzs !== null ? "TZS" : "USDC",
      price: num(o.price),
      fee: num(o.fee_usdc),
      error: o.error,
      refs,
      note: null,
    });
  }

  for (const d of deposits) {
    const refs: ActivityItem["refs"] = [];
    if (d.ntzs_reference) refs.push({ label: "nTZS reference", value: d.ntzs_reference });
    else if (d.ntzs_deposit_id) refs.push({ label: "nTZS deposit", value: d.ntzs_deposit_id });
    if (d.transfer_tx) refs.push({ label: "Transfer", value: d.transfer_tx, href: basescan(d.transfer_tx) });
    refs.push({ label: "Paid from", value: d.phone });
    items.push({
      id: `deposit:${d.id}`,
      kind: "deposit",
      status: normaliseStatus(d.status),
      at: d.created_at,
      settledAt: d.settled_at,
      asset: null,
      qty: null,
      amount: d.amount_tzs,
      currency: "TZS",
      price: null,
      fee: null,
      error: d.error,
      refs,
      note: d.status === "pending"
        ? "Waiting for the mobile money prompt to be approved."
        : d.usdc_credited
          ? `Credited ${Number(d.usdc_credited).toFixed(2)} USDC`
            + (d.rate_tzs_usdc ? ` at ${Number(d.rate_tzs_usdc).toFixed(2)} TZS to the dollar.` : ".")
          : null,
    });
  }

  for (const o of otc) {
    const refs: ActivityItem["refs"] = [{ label: "Reference", value: o.reference }];
    if (o.funding_tx) refs.push({ label: "Your payment", value: o.funding_tx, href: basescan(o.funding_tx) });
    if (o.settle_tx) refs.push({ label: "CAPX transfer", value: o.settle_tx, href: basescan(o.settle_tx) });
    refs.push({ label: "Wallet", value: o.address });
    items.push({
      id: `otc:${o.reference}`,
      kind: o.side === "sell" ? "self-sell" : "self-buy",
      status: normaliseStatus(o.status),
      at: o.created_at,
      settledAt: o.settled_at,
      asset: o.security,
      qty: num(o.qty),
      amount: num(o.net_usdc),
      currency: "USDC",
      price: num(o.price_tzs),
      fee: num(o.fee_usdc),
      error: o.failure,
      refs,
      note: o.status === "funded"
        ? "Paid. Waiting for CAPX to send."
        : o.status === "quoted"
          ? "Priced. Nothing has moved yet."
          : null,
    });
  }

  for (const e of ledger) {
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const amount = Number(e.amount);
    const refs: ActivityItem["refs"] = [];
    if (typeof meta.quoteId === "string") refs.push({ label: "Quote", value: meta.quoteId });
    if (e.ref) refs.push({ label: "Reference", value: e.ref });
    if (typeof meta.destination === "string") refs.push({ label: "Sent to", value: meta.destination });
    items.push({
      id: `ledger:${e.id}`,
      kind: e.kind === "adjustment" ? "adjustment" : "withdrawal",
      // A ledger entry is written once the movement has happened, so there is
      // nothing pending about one.
      status: "settled",
      at: e.created_at,
      settledAt: e.created_at,
      asset: e.asset === "TZS" || e.asset === "USDC" ? null : e.asset,
      qty: null,
      amount: Math.abs(amount),
      currency: e.asset === "USDC" ? "USDC" : "TZS",
      price: null,
      fee: null,
      error: null,
      refs,
      note: typeof meta.reason === "string" ? meta.reason
        : typeof meta.note === "string" ? meta.note
        : e.kind === "adjustment"
          ? `${amount >= 0 ? "Added to" : "Taken from"} your balance by the CAPX desk.`
          : null,
    });
  }

  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}
