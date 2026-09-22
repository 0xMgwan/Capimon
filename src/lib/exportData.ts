import "server-only";
import { db, migrate } from "./db";

/**
 * The operations exports: every customer, position, trade and cash movement,
 * as flat tables for a spreadsheet.
 *
 * Built for two readers with the same need — CAPX reconciling its books and
 * FIMCO keeping a broker's client records — so each table is one row per real
 * thing (a customer, a position, an order, a deposit) with every figure the
 * row can honestly carry, rather than a summary that has to be unpicked.
 *
 * Amounts are in the currency they happened in. A shilling trade is reported
 * in shillings and a dollar trade in dollars, each with its currency column,
 * so nothing is silently converted at a rate the reader did not choose.
 */

export type Table = { columns: string[]; rows: (string | number | null)[][] };
export type Range = { from: Date | null; to: Date | null };

export const DATASETS = {
  customers: "One row per customer: identity, verification, funding, trading activity and what they hold.",
  holdings: "One row per customer per security: quantity, cost, current value and profit.",
  trades: "One row per order: when, who, what, how many, at what price, the fee and the cash moved.",
  cash: "Every deposit and withdrawal: method, amount, status and references.",
  ledger: "Every ledger entry, unaggregated — the record everything else is derived from.",
  attestations: "Every custody filing: who filed it, what it said, who approved it.",
  issuance: "Every mint and burn, with its transaction.",
} as const;
export type Dataset = keyof typeof DATASETS;

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const CASH = new Set(["TZS", "USDC"]);

/** `created_at` within the range, as a SQL fragment's parameters. */
function bounds(r: Range) {
  return {
    from: r.from ?? new Date(0),
    to: r.to ?? new Date("9999-12-31T00:00:00Z"),
  };
}

type Entry = {
  id: string; user_id: string; kind: string; asset: string; amount: string;
  ref: string | null; metadata: Record<string, unknown> | null; created_at: string;
};
type Person = {
  id: string; username: string | null; name: string | null; email: string; phone: string | null;
};

async function people(): Promise<Map<string, Person>> {
  const rows = await db()<Person[]>`
    select id::text, username, name, email, phone from capx.users`;
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Orders reconstructed from their ledger legs.
 *
 * Each trade writes a share leg and a cash leg keyed to the same order id; the
 * share leg carries the price and currency, the cash leg the shillings moved
 * and the fee. Pairing them gives one complete row per order.
 */
function pairTrades(entries: Entry[]) {
  const byOrder = new Map<string, { share?: Entry; cash?: Entry }>();
  for (const e of entries) {
    if (e.kind !== "buy" && e.kind !== "sell") continue;
    const oid = String(e.metadata?.orderId ?? e.ref?.split(":")[0] ?? e.id);
    const slot = byOrder.get(oid) ?? {};
    if (CASH.has(e.asset)) slot.cash = e; else slot.share = e;
    byOrder.set(oid, slot);
  }
  return [...byOrder.entries()]
    .filter(([, v]) => v.share)
    .map(([orderId, v]) => {
      const s = v.share!;
      const qty = Math.abs(Number(s.amount));
      const price = Number(s.metadata?.price ?? v.cash?.metadata?.price ?? 0);
      const currency = String(s.metadata?.currency ?? (v.cash?.asset === "TZS" ? "TZS" : "USD"));
      const fee = Number(v.cash?.metadata?.fee ?? 0);
      const cash = v.cash ? Number(v.cash.amount) : null;
      return {
        orderId, userId: s.user_id, at: s.created_at, side: s.kind, symbol: s.asset, qty, price, currency,
        gross: qty * price, fee, cash, cashAsset: v.cash?.asset ?? null,
      };
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

async function allEntries(r?: Range): Promise<Entry[]> {
  const b = r ? bounds(r) : null;
  return b
    ? db()<Entry[]>`
        select id::text, user_id::text, kind, asset, amount::text, ref, metadata, created_at
          from capx.ledger_entries
         where created_at >= ${b.from} and created_at < ${b.to}
         order by created_at`
    : db()<Entry[]>`
        select id::text, user_id::text, kind, asset, amount::text, ref, metadata, created_at
          from capx.ledger_entries order by created_at`;
}

/** Current prices: DSE shares in shillings from our oracle, US shares in dollars. */
async function prices(): Promise<Map<string, { price: number; currency: string }>> {
  const out = new Map<string, { price: number; currency: string }>();
  const { dseSecurities } = await import("./dseSecurities");
  const { readOraclePrice } = await import("./oracle");
  await Promise.all((await dseSecurities().catch(() => [])).map(async (d) => {
    const q = await readOraclePrice(d.symbol).catch(() => null);
    if (q) out.set(d.symbol, { price: q.price, currency: "TZS" });
  }));
  try {
    const { getMarkets } = await import("./markets");
    const m = await getMarkets({ depth: 1 });
    for (const x of m) if (!out.has(x.symbol)) out.set(x.symbol, { price: x.price, currency: "USD" });
  } catch { /* US prices omitted rather than guessed */ }
  return out;
}

export async function buildTable(dataset: Dataset, range: Range): Promise<Table> {
  await migrate();
  const sql = db();
  const b = bounds(range);

  if (dataset === "ledger") {
    const [ppl, entries] = await Promise.all([people(), allEntries(range)]);
    return {
      columns: ["entry_id", "created_at", "user_id", "username", "name", "email", "kind", "asset", "amount", "reference", "details"],
      rows: entries.map((e) => {
        const p = ppl.get(e.user_id);
        return [e.id, iso(e.created_at), e.user_id, p?.username ?? null, p?.name ?? null, p?.email ?? null,
          e.kind, e.asset, Number(e.amount), e.ref, e.metadata ? JSON.stringify(e.metadata) : null];
      }),
    };
  }

  if (dataset === "trades") {
    const [ppl, entries] = await Promise.all([people(), allEntries(range)]);
    return {
      columns: ["executed_at", "order_id", "user_id", "username", "name", "email", "phone", "side", "security",
        "quantity", "price", "currency", "gross_value", "fee", "cash_moved", "cash_asset"],
      rows: pairTrades(entries).map((t) => {
        const p = ppl.get(t.userId);
        return [iso(t.at), t.orderId, t.userId, p?.username ?? null, p?.name ?? null, p?.email ?? null, p?.phone ?? null,
          t.side, t.symbol, t.qty, t.price, t.currency, round(t.gross), t.fee, t.cash, t.cashAsset];
      }),
    };
  }

  if (dataset === "cash") {
    const [ppl, deposits, withdrawals] = await Promise.all([
      people(),
      sql<{ id: string; user_id: string; amount_tzs: number; status: string; phone: string | null;
            ntzs_deposit_id: string | null; ntzs_reference: string | null; metadata: Record<string, unknown>;
            created_at: string; settled_at: string | null; error: string | null }[]>`
        select id::text, user_id::text, amount_tzs, status, phone, ntzs_deposit_id, ntzs_reference, metadata,
               created_at, settled_at, error
          from capx.deposits where created_at >= ${b.from} and created_at < ${b.to} order by created_at`,
      sql<Entry[]>`
        select id::text, user_id::text, kind, asset, amount::text, ref, metadata, created_at
          from capx.ledger_entries
         where kind = 'withdrawal' and created_at >= ${b.from} and created_at < ${b.to}
         order by created_at`,
    ]);
    const rows: Table["rows"] = [];
    for (const d of deposits) {
      const p = ppl.get(d.user_id);
      const method = String(d.metadata?.paymentMethod ?? "mobile_money");
      rows.push([iso(d.created_at), "deposit", d.id, d.user_id, p?.username ?? null, p?.name ?? null, p?.email ?? null,
        d.amount_tzs, "TZS", method, method === "bank_transfer"
          ? String(d.metadata?.payerAccountNumber ?? "") : d.phone,
        d.status, d.ntzs_reference ?? d.ntzs_deposit_id, iso(d.settled_at), d.error]);
    }
    for (const w of withdrawals) {
      const p = ppl.get(w.user_id);
      const m = w.metadata ?? {};
      rows.push([iso(w.created_at), "withdrawal", w.id, w.user_id, p?.username ?? null, p?.name ?? null, p?.email ?? null,
        Math.abs(Number(w.amount)), w.asset, m.bankCode ? "bank_transfer" : "mobile_money",
        String(m.destination ?? m.phoneNumber ?? ""), "sent", String(m.quoteId ?? w.ref ?? ""), null, null]);
    }
    rows.sort((x, y) => String(x[0]).localeCompare(String(y[0])));
    return {
      columns: ["at", "type", "id", "user_id", "username", "name", "email", "amount", "currency", "method",
        "account_or_phone", "status", "reference", "settled_at", "error"],
      rows,
    };
  }

  if (dataset === "holdings" || dataset === "customers") {
    const [ppl, entries, px] = await Promise.all([people(), allEntries(), prices()]);
    const { positionCosts } = await import("./pnl");

    // Positions per user per asset, from the whole ledger — a holding is as of
    // now, not as of the range.
    const pos = new Map<string, Map<string, { qty: number; bought: number; sold: number; n: number; first: string | null; last: string | null }>>();
    for (const e of entries) {
      if (CASH.has(e.asset)) continue;
      const u = pos.get(e.user_id) ?? new Map();
      const p = u.get(e.asset) ?? { qty: 0, bought: 0, sold: 0, n: 0, first: null, last: null };
      const a = Number(e.amount);
      p.qty += a;
      if (a > 0) { p.bought += a; p.first ??= e.created_at; } else p.sold += -a;
      p.n += 1; p.last = e.created_at;
      u.set(e.asset, p); pos.set(e.user_id, u);
    }
    const costs = new Map<string, Awaited<ReturnType<typeof positionCosts>>>();
    for (const uid of pos.keys()) costs.set(uid, await positionCosts(uid).catch(() => new Map()));

    if (dataset === "holdings") {
      const rows: Table["rows"] = [];
      for (const [uid, assets] of pos) {
        const p = ppl.get(uid);
        for (const [asset, h] of assets) {
          if (Math.abs(h.qty) < 1e-9) continue;
          const c = costs.get(uid)?.get(asset);
          const cur = px.get(asset);
          const currency = c?.currency ?? cur?.currency ?? "USD";
          const value = cur ? h.qty * cur.price : null;
          const basis = c?.costBasis ?? (c ? c.avgCost * h.qty : null);
          const pnl = value !== null && basis ? value - basis : null;
          rows.push([uid, p?.username ?? null, p?.name ?? null, p?.email ?? null, p?.phone ?? null, asset,
            round8(h.qty), c ? round(c.avgCost) : null, currency, basis !== null ? round(basis) : null,
            cur?.price ?? null, value !== null ? round(value) : null, pnl !== null ? round(pnl) : null,
            pnl !== null && basis ? round((pnl / basis) * 100) : null, c ? round(c.realised) : null,
            round8(h.bought), round8(h.sold), h.n, iso(h.first), iso(h.last)]);
        }
      }
      return {
        columns: ["user_id", "username", "name", "email", "phone", "security", "quantity", "average_cost", "currency",
          "cost_basis", "current_price", "market_value", "unrealised_pnl", "unrealised_pnl_pct", "realised_pnl",
          "total_bought", "total_sold", "trades", "first_bought_at", "last_trade_at"],
        rows,
      };
    }

    // customers
    const [users, kyc, deposits] = await Promise.all([
      sql<{ id: string; email: string; name: string | null; username: string | null; phone: string | null;
            country: string | null; doc_type: string | null; nida_number: string | null; kyc_status: string;
            created_at: string; terms_accepted_at: string | null }[]>`
        select id::text, email, name, username, phone, country, doc_type, nida_number, kyc_status,
               created_at, terms_accepted_at from capx.users order by created_at`,
      sql<{ user_id: string; created_at: string; reviewed_at: string | null; reviewed_by: string | null }[]>`
        select distinct on (user_id) user_id::text, created_at, reviewed_at, reviewed_by
          from capx.kyc_submissions order by user_id, created_at desc`,
      sql<{ user_id: string; n: number; total: string; first: string | null; last: string | null }[]>`
        select user_id::text, count(*)::int as n, coalesce(sum(amount_tzs), 0)::text as total,
               min(created_at) as first, max(created_at) as last
          from capx.deposits where status in ('settled','completed','credited')
         group by user_id`,
    ]);
    const kycBy = new Map(kyc.map((k) => [k.user_id, k]));
    const depBy = new Map(deposits.map((d) => [d.user_id, d]));
    const trades = pairTrades(entries);
    const now = Date.now();
    const rows: Table["rows"] = users.map((u) => {
      const mine = trades.filter((t) => t.userId === u.id);
      const wd = entries.filter((e) => e.user_id === u.id && e.kind === "withdrawal" && e.asset === "TZS");
      const tzs = entries.filter((e) => e.user_id === u.id && e.asset === "TZS").reduce((s, e) => s + Number(e.amount), 0);
      const holdings = [...(pos.get(u.id) ?? new Map()).entries()]
        .filter(([, h]) => Math.abs(h.qty) >= 1e-9).map(([a, h]) => `${a} ${round8(h.qty)}`).join("; ");
      const first = mine[0]?.at ?? null;
      const last = mine[mine.length - 1]?.at ?? null;
      const months = first ? Math.max(1, (now - Date.parse(first)) / (30.44 * 86400_000)) : null;
      const k = kycBy.get(u.id);
      const d = depBy.get(u.id);
      const lastActivity = [last, d?.last ?? null, wd[wd.length - 1]?.created_at ?? null]
        .filter(Boolean).sort().pop() ?? null;
      const tzsTrades = mine.filter((t) => t.currency === "TZS");
      const usdTrades = mine.filter((t) => t.currency !== "TZS");
      return [u.id, u.username, u.name, u.email, u.phone, u.country, u.doc_type ?? "nida", u.nida_number, u.kyc_status,
        iso(k?.created_at), iso(k?.reviewed_at), k?.reviewed_by ?? null, iso(u.created_at), iso(u.terms_accepted_at),
        round(tzs), d?.n ?? 0, num(d?.total) ?? 0, iso(d?.first), iso(d?.last),
        wd.length, round(wd.reduce((s, e) => s + Math.abs(Number(e.amount)), 0)),
        mine.length, mine.filter((t) => t.side === "buy").length, mine.filter((t) => t.side === "sell").length,
        mine.filter((t) => now - Date.parse(t.at) < 30 * 86400_000).length,
        months ? round(mine.length / months) : null,
        round(tzsTrades.reduce((s, t) => s + t.gross, 0)), round(usdTrades.reduce((s, t) => s + t.gross, 0)),
        round(tzsTrades.reduce((s, t) => s + t.fee, 0)),
        tzsTrades.length ? round(tzsTrades.reduce((s, t) => s + t.gross, 0) / tzsTrades.length) : null,
        holdings || null, iso(first), iso(last), iso(lastActivity)];
    });
    return {
      columns: ["user_id", "username", "name", "email", "phone", "country", "id_type", "id_number", "kyc_status",
        "kyc_submitted_at", "kyc_reviewed_at", "kyc_reviewed_by", "joined_at", "terms_accepted_at",
        "tzs_balance", "deposits_count", "deposits_total_tzs", "first_deposit_at", "last_deposit_at",
        "withdrawals_count", "withdrawals_total_tzs", "trades_total", "buys", "sells", "trades_last_30_days",
        "trades_per_month", "traded_value_tzs", "traded_value_usd", "fees_paid_tzs", "average_trade_tzs",
        "holdings", "first_trade_at", "last_trade_at", "last_activity_at"],
      rows,
    };
  }

  if (dataset === "attestations") {
    const rows = await sql<Record<string, unknown>[]>`
      select id::text, security, custodian, quantity::float8 as quantity, locked::float8 as locked, doc_ref,
             status, filed_by, approved_by, approved_at, issued_at, expires_at, created_at
        from capx.custody_attestations
       where created_at >= ${b.from} and created_at < ${b.to} order by created_at`;
    return {
      columns: ["filed_at", "id", "security", "custodian", "shares_held", "shares_locked", "statement_reference",
        "status", "filed_by", "approved_by", "approved_at", "valid_from", "valid_until"],
      rows: rows.map((r) => [iso(r.created_at), r.id as string, r.security as string, r.custodian as string,
        num(r.quantity), num(r.locked), (r.doc_ref as string) ?? null, r.status as string, (r.filed_by as string) ?? null,
        (r.approved_by as string) ?? null, iso(r.approved_at), iso(r.issued_at), iso(r.expires_at)]),
    };
  }

  // issuance
  const rows = await sql<Record<string, unknown>[]>`
    select id::text, security, kind, quantity::float8 as quantity, tx_hash, actor, created_at
      from capx.issuance_events
     where created_at >= ${b.from} and created_at < ${b.to} order by created_at`;
  return {
    columns: ["at", "id", "security", "kind", "quantity", "transaction", "basescan_link", "recorded_by"],
    rows: rows.map((r) => [iso(r.created_at), r.id as string, r.security as string, r.kind as string, num(r.quantity),
      (r.tx_hash as string) ?? null, r.tx_hash ? `https://basescan.org/tx/${r.tx_hash}` : null, (r.actor as string) ?? null]),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

/** CSV that Excel opens correctly: BOM for UTF-8, quoted fields, CRLF lines. */
export function toCsv(t: Table): string {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    // Guard against spreadsheet formula injection from user-entered text.
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [t.columns, ...t.rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
