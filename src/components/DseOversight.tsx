"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  tzs, qty, when, day, Pill, kycTone, statusTone, Tx, Addr,
  Table, Td, Row, Toolbar, Stat, downloadCsv, useSearch, useSort, sorted,
  type Choice,
} from "./dse/shared";

/**
 * The exchange's portal onto CAPX's Dar es Salaam book.
 *
 * Laid out as a filing cabinet rather than a dashboard, because the reader's
 * job is to check rather than to trade: the register, the blotter, the
 * custody file, the money, and the log of who opened what. Every number is
 * live from the same tables CAPX and the customer read.
 *
 * Every table searches, filters, sorts and downloads. That is not polish —
 * a supervisor arrives with a question about one person or one security, and
 * a page that can only be scrolled makes them read two hundred rows to answer
 * it. And every hash is a link, because a hash that cannot be followed is a
 * claim the reader has been asked to take on trust, on the one page whose
 * entire purpose is not having to.
 *
 * Two deliberate absences. There is nothing to click that changes anything,
 * because the token behind it cannot change anything and a disabled control
 * is a worse way of saying so. And there is no US security anywhere — not
 * greyed out, not filtered in the browser, simply never sent.
 *
 * The token lives in React state and is never written to storage. A
 * supervisory credential left in localStorage outlives the person's attention
 * and the browser session, and this one opens identity documents.
 */

type Position = { symbol: string; qty: number };

type Security = {
  symbol: string; name: string; status: string;
  token: string | null; decimals: number; chainId: number;
  holders: number; held: number;
  custodian: string | null; locked: number | null;
  attestationExpires: string | null; fresh: boolean;
  issued: number | null; clientHeld: number | null; unallocated: number | null;
  ratioPct: number | null; headroom: number | null; drift: number | null;
  backingError: string | null;
};

type Overview = {
  securities: Security[];
  holders: number; verified: number; pending: number; unverified: number;
  orders30d: number; turnover30d: number;
  cashHeldTzs: number; depositedTzs: number; withdrawnTzs: number;
};

type RegisterRow = {
  userId: string; name: string | null; email: string; phone: string | null; country: string;
  kycStatus: string; kycSource: string | null; kycAttestedBy: string | null; joined: string;
  positions: Position[]; trades: number; lastTrade: string | null; cashTzs: number;
};

type Order = {
  id: string; userId: string; name: string | null; email: string; kycStatus: string;
  side: string; symbol: string; qty: number | null; price: number | null;
  amountTzs: number | null; status: string; error: string | null;
  createdAt: string; settledAt: string | null; txHash: string | null;
};

type Custody = {
  attestations: { id: string; security: string; custodian: string; quantity: number;
                  locked: number; docRef: string | null; issuedAt: string; expiresAt: string;
                  status: string; approvedBy: string | null; approvedAt: string | null;
                  signer: string | null; fresh: boolean }[];
  issuance: { id: string; security: string; kind: string; quantity: number;
              txHash: string | null; actor: string | null; createdAt: string }[];
};

type Money = {
  deposits: { id: string; userId: string; name: string | null; email: string; amountTzs: number;
              status: string; route: string | null; reference: string | null;
              fundingTx: string | null; transferTx: string | null;
              createdAt: string; settledAt: string | null }[];
  withdrawals: { id: string; userId: string; name: string | null; email: string;
                 amountTzs: number; status: string; destination: string;
                 createdAt: string; sentAt: string | null }[];
  fees: { security: string; trades: number; considerationTzs: number; feeTzs: number;
          brokerTzs: number; capxTzs: number }[];
  split: { totalBps: number; brokerBps: number; capxBps: number };
};

type Access = { id: string; actor: string; action: string; subject: string | null;
                detail: Record<string, unknown>; ip: string | null; createdAt: string };

type Book = {
  actor: string; readOnly: boolean; overview: Overview; register: RegisterRow[];
  orders: Order[]; custody: Custody; money: Money; access: Access[];
};

type File = {
  user: { userId: string; name: string | null; email: string; phone: string | null;
          country: string; nida: string | null; docType: string | null; kycStatus: string;
          kycSource: string | null; kycAttestedBy: string | null; kycAttestedAt: string | null;
          joined: string };
  documents: { id: string; docType: string; docNumber: string | null; status: string;
               reason: string | null; reviewedBy: string | null; reviewedAt: string | null;
               filedAt: string; docMime: string; selfieMime: string }[];
  positions: { symbol: string; qty: number; bought: number; sold: number }[];
  orders: { id: string; side: string; symbol: string; qty: number | null; price: number | null;
            amountTzs: number | null; status: string; createdAt: string;
            settledAt: string | null; txHash: string | null }[];
  ledger: { id: string; kind: string; asset: string; amount: number; ref: string | null;
            createdAt: string }[];
  deposits: { id: string; amountTzs: number; status: string; route: string | null;
              reference: string | null; fundingTx: string | null; transferTx: string | null;
              createdAt: string; settledAt: string | null }[];
  withdrawals: { id: string; amountTzs: number; status: string; destination: string;
                 createdAt: string; sentAt: string | null }[];
};

type Tab = "overview" | "register" | "orders" | "custody" | "money" | "access";

const ALL: Choice = { label: "All", value: "" };
const choices = (label: string, values: string[]): Choice[] =>
  [{ label, value: "" }, ...[...new Set(values)].sort().map((v) => ({ label: v, value: v }))];

export function DseOversight() {
  const [token, setToken] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async (t: string) => {
    if (!t) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/dse/oversight?token=${encodeURIComponent(t)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) {
        throw new Error(j.code === "unauthorised" ? "That token was not accepted." : j.error);
      }
      setBook(j as Book);
      setLoadedAt(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the book.");
    } finally {
      setBusy(false);
    }
  }, []);

  /* Refreshed on a timer once in, because somebody supervising a live market
     should not have to wonder whether what is on screen is from this hour. */
  useEffect(() => {
    if (!book || !token) return;
    const id = setInterval(() => void load(token), 60_000);
    return () => clearInterval(id);
  }, [book, token, load]);

  const openFile = async (userId: string) => {
    setFileBusy(true); setFile(null); setErr(null);
    try {
      const r = await fetch(
        `/api/dse/customer?id=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`,
        { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not open that file.");
      setFile(j as File);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open that file.");
      setFileBusy(false);
      return;
    }
    setFileBusy(false);
  };

  if (!book) {
    return (
      <div className="mx-auto max-w-[520px] px-5 pb-24 pt-20 sm:px-8">
        <div className="eyebrow">Dar es Salaam Stock Exchange</div>
        <h1 className="display mt-3 text-3xl">Oversight portal.</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--muted)]">
          The CAPX book in DSE-listed securities: the shareholder register, every order,
          what backs each token, the money in and out, and a record of who looked at what.
          Read-only.
        </p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(token); }}
          type="password" placeholder="Access token"
          className="mt-6 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          onClick={() => void load(token)} disabled={busy || !token}
          className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50">
          {busy ? "Opening…" : "Open the book"}
        </button>
        {err && <p className="mt-3 text-xs text-[var(--color-down)]">{err}</p>}
        <p className="mt-6 text-[11px] leading-relaxed text-[var(--muted)]">
          Opening a shareholder&apos;s file or an identity document is recorded against this
          token, with the time it happened. The log is on the last tab and you can read your
          own.
        </p>
      </div>
    );
  }

  const counts: Record<Tab, number | null> = {
    overview: book.overview.securities.length,
    register: book.register.length,
    orders: book.orders.length,
    custody: book.custody.attestations.length + book.custody.issuance.length,
    money: book.money.deposits.length + book.money.withdrawals.length,
    access: book.access.length,
  };
  const TABS: [Tab, string][] = [
    ["overview", "Overview"], ["register", "Register"], ["orders", "Orders"],
    ["custody", "Custody"], ["money", "Money"], ["access", "Access log"],
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="eyebrow">Dar es Salaam Stock Exchange · oversight</div>
          <h1 className="display mt-2 text-3xl">The CAPX book.</h1>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <Pill tone="flat">{book.actor}</Pill>
          {book.readOnly && <Pill tone="flat">read-only</Pill>}
          <span className="tnum">
            {loadedAt ? `as at ${loadedAt.toLocaleTimeString("en-GB", { timeStyle: "short" })}` : ""}
          </span>
          <button onClick={() => void load(token)} className="underline underline-offset-2">
            {busy ? "refreshing…" : "refresh"}
          </button>
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
        Everything CAPX holds in Dar es Salaam listings: who owns what, every order behind it,
        what backs each token, and the money in and out.
      </p>

      <div className="mt-6 flex flex-wrap gap-1.5">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              tab === id ? "bg-[var(--fg)] text-[var(--bg)]" : "border hairline hover:surface"
            }`}>
            {label}
            {counts[id] !== null && (
              <span className={`tnum ml-1.5 text-[10.5px] ${
                tab === id ? "opacity-70" : "text-[var(--muted)]"}`}>
                {counts[id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {err && <p className="mt-4 text-xs text-[var(--color-down)]">{err}</p>}

      {tab === "overview" && <OverviewTab o={book.overview} />}
      {tab === "register" && <RegisterTab rows={book.register} onOpen={openFile} />}
      {tab === "orders" && <OrdersTab rows={book.orders} onOpen={openFile} />}
      {tab === "custody" && <CustodyTab c={book.custody} securities={book.overview.securities} />}
      {tab === "money" && <MoneyTab m={book.money} />}
      {tab === "access" && <AccessTab rows={book.access} />}

      {(file || fileBusy) && (
        <CustomerFile file={file} busy={fileBusy} token={token} onClose={() => setFile(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OverviewTab({ o }: { o: Overview }) {
  const anyStale = o.securities.some((s) => !s.fresh);
  const anyDrift = o.securities.some((s) => (s.drift ?? 0) !== 0);

  return (
    <section className="mt-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Shareholders" value={o.holders.toLocaleString()}
          sub={`${o.verified} verified · ${o.pending} pending · ${o.unverified} not verified`} />
        <Stat label="Orders · 30 days" value={o.orders30d.toLocaleString()}
          sub={`${tzs(o.turnover30d)} TZS turnover`} />
        <Stat label="Shillings held" value={tzs(o.cashHeldTzs)}
          sub="Uninvested cash of holders on this book" />
        <Stat label="In / out" value={`${tzs(o.depositedTzs)} / ${tzs(o.withdrawnTzs)}`}
          sub="All time, shillings" />
      </div>

      <h2 className="mt-8 text-sm font-medium">Listed securities</h2>
      <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[var(--muted)]">
        Each token is linked to the chain. <strong className="font-medium">Issued</strong> is what
        exists on chain; <strong className="font-medium">held by customers</strong> is the part
        claimed by shareholders and <strong className="font-medium">unallocated</strong> is the
        rest, which CAPX has issued but not sold.{" "}
        <strong className="font-medium">Locked</strong> is what the custodian confirms is
        earmarked against them, and <strong className="font-medium">cover</strong> is locked
        divided by issued.
      </p>

      <Table cols={[
        { label: "Security" }, { label: "Token" }, { label: "Holders", align: "right" },
        { label: "Issued", align: "right" }, { label: "Held by customers", align: "right" },
        { label: "Unallocated", align: "right" }, { label: "Locked", align: "right" },
        { label: "Cover", align: "right" }, { label: "Headroom", align: "right" },
        { label: "Attestation" },
      ]} empty="No DSE securities are listed yet.">
        {o.securities.map((s) => (
          <Row key={s.symbol}>
            <Td>
              <div className="font-medium">{s.symbol}</div>
              <div className="text-[11px] text-[var(--muted)]">{s.name}</div>
              <div className="mt-0.5"><Pill tone={s.status === "live" ? "ok" : "warn"}>{s.status}</Pill></div>
            </Td>
            <Td><Addr address={s.token} kind="token" chainId={s.chainId} /></Td>
            <Td align="right" className="tnum">{s.holders}</Td>
            <Td align="right" className="tnum">
              {s.issued === null
                ? <span className="text-[var(--color-down)]" title={s.backingError ?? ""}>unread</span>
                : qty(s.issued)}
            </Td>
            <Td align="right" className="tnum">{qty(s.held)}</Td>
            <Td align="right" className="tnum">
              {s.unallocated === null ? "—" : qty(s.unallocated)}
            </Td>
            <Td align="right" className="tnum">{s.locked === null ? "—" : qty(s.locked)}</Td>
            <Td align="right" className="tnum">
              {s.ratioPct === null
                ? <span className="text-[var(--muted)]">∞</span>
                : <span style={{ color: s.ratioPct < 100 ? "var(--color-down)" : undefined }}>
                    {s.ratioPct.toFixed(1)}%
                  </span>}
            </Td>
            <Td align="right" className="tnum">{s.headroom === null ? "—" : qty(s.headroom)}</Td>
            <Td>
              {s.attestationExpires
                ? <Pill tone={s.fresh ? "ok" : "bad"}>
                    {s.fresh ? `to ${day(s.attestationExpires)}` : `expired ${day(s.attestationExpires)}`}
                  </Pill>
                : <Pill tone="bad">none in force</Pill>}
              {s.custodian && (
                <div className="mt-1 text-[11px] text-[var(--muted)]">{s.custodian}</div>
              )}
              {(s.drift ?? 0) !== 0 && (
                <div className="mt-1 text-[11px] text-[var(--color-down)]">
                  drift {qty(s.drift as number)}
                </div>
              )}
            </Td>
          </Row>
        ))}
      </Table>

      {(anyStale || anyDrift) && (
        <div className="mt-3 rounded-2xl border p-3.5 text-[12px] leading-relaxed"
          style={{ borderColor: "var(--color-down)", color: "var(--color-down)" }}>
          {anyStale && <div>An attestation has expired. Evidence goes stale: a statement from
            months ago does not say the shares are there today, and an expired one backs nothing.</div>}
          {anyDrift && <div className={anyStale ? "mt-1" : ""}>Issuance drift: what the chain
            reports does not match what the issuance log recorded. The two should agree exactly.</div>}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function RegisterTab({ rows, onOpen }: { rows: RegisterRow[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [kyc, setKyc] = useState("");
  const [sec, setSec] = useState("");
  const { sort, toggle } = useSort({ key: "joined", dir: "desc" });

  const searched = useSearch(rows, q, (r) => [r.name, r.email, r.phone, r.country, r.userId]);
  const filtered = useMemo(() => searched.filter((r) =>
    (!kyc || r.kycStatus === kyc) &&
    (!sec || r.positions.some((p) => p.symbol === sec))), [searched, kyc, sec]);

  const view = sorted(filtered, sort, (r, k) => ({
    name: r.name ?? r.email, kyc: r.kycStatus, trades: r.trades,
    cash: r.cashTzs, joined: r.joined, last: r.lastTrade,
    holdings: r.positions.reduce((n, p) => n + p.qty, 0),
  }[k]));

  const secs = [...new Set(rows.flatMap((r) => r.positions.map((p) => p.symbol)))];

  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium">Shareholder register</h2>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Everyone holding or having traded a DSE security. Opening a file is recorded against
        this token.
      </p>
      <Toolbar
        q={q} onQ={setQ} placeholder="Search name, email, phone, country or id…"
        shown={view.length} total={rows.length}
        filters={[
          { label: "Verification", value: kyc, onChange: setKyc,
            options: [{ ...ALL, label: "Any verification" },
                      ...["approved", "pending", "none", "rejected"].map((v) => ({ label: v, value: v }))] },
          { label: "Holds", value: sec, onChange: setSec,
            options: [{ ...ALL, label: "Any security" },
                      ...secs.sort().map((v) => ({ label: `holds ${v}`, value: v }))] },
        ]}
        onCsv={() => downloadCsv("dse-register",
          ["name", "email", "phone", "country", "kyc_status", "attested_by", "holdings",
           "trades", "last_trade", "cash_tzs", "joined", "user_id"],
          view.map((r) => [r.name, r.email, r.phone, r.country, r.kycStatus,
            r.kycAttestedBy ?? r.kycSource, r.positions.map((p) => `${p.symbol} ${p.qty}`).join(" / "),
            r.trades, r.lastTrade, r.cashTzs, r.joined, r.userId]))}
      />
      <Table sort={sort} onSort={toggle} empty="Nobody matches that."
        cols={[
          { key: "name", label: "Shareholder" }, { label: "Contact" },
          { key: "kyc", label: "Verification" }, { key: "holdings", label: "Holdings" },
          { key: "trades", label: "Trades", align: "right" },
          { key: "cash", label: "Cash (TZS)", align: "right" },
          { key: "joined", label: "Joined" }, { label: "" },
        ]}>
        {view.map((r) => (
          <Row key={r.userId}>
            <Td>
              <div className="font-medium">{r.name ?? "—"}</div>
              <div className="text-[11px] text-[var(--muted)]">{r.country}</div>
            </Td>
            <Td>
              <div className="break-all">{r.email}</div>
              <div className="text-[11px] text-[var(--muted)]">{r.phone ?? "—"}</div>
            </Td>
            <Td>
              <Pill tone={kycTone(r.kycStatus)}>{r.kycStatus}</Pill>
              <div className="mt-1 text-[11px] text-[var(--muted)]">
                {r.kycAttestedBy ? `attested by ${r.kycAttestedBy}` : `by ${r.kycSource ?? "CAPX"}`}
              </div>
            </Td>
            <Td className="tnum">
              {r.positions.length
                ? r.positions.map((p) => (
                    <div key={p.symbol}>
                      <span className="font-medium">{p.symbol}</span> {qty(p.qty)}
                    </div>
                  ))
                : <span className="text-[var(--muted)]">—</span>}
            </Td>
            <Td align="right" className="tnum">
              {r.trades}
              <div className="text-[11px] text-[var(--muted)]">{day(r.lastTrade)}</div>
            </Td>
            <Td align="right" className="tnum">{tzs(r.cashTzs)}</Td>
            <Td>{day(r.joined)}</Td>
            <Td>
              <button onClick={() => onOpen(r.userId)}
                className="whitespace-nowrap rounded-full border hairline px-3 py-1 text-[11px] font-medium hover:surface">
                Open file
              </button>
            </Td>
          </Row>
        ))}
      </Table>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function OrdersTab({ rows, onOpen }: { rows: Order[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [sec, setSec] = useState("");
  const [side, setSide] = useState("");
  const [status, setStatus] = useState("");
  const { sort, toggle } = useSort({ key: "created", dir: "desc" });

  const searched = useSearch(rows, q, (r) => [r.name, r.email, r.symbol, r.id, r.txHash, r.error]);
  const filtered = useMemo(() => searched.filter((r) =>
    (!sec || r.symbol === sec) && (!side || r.side === side) && (!status || r.status === status)),
    [searched, sec, side, status]);

  const view = sorted(filtered, sort, (r, k) => ({
    created: r.createdAt, who: r.name ?? r.email, side: r.side, symbol: r.symbol,
    qty: r.qty, price: r.price, amount: r.amountTzs, status: r.status, settled: r.settledAt,
  }[k]));

  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium">Order blotter</h2>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Every order in a DSE security, settled or not, with the chain transaction where there
        was one.
      </p>
      <Toolbar
        q={q} onQ={setQ} placeholder="Search shareholder, security, order id or hash…"
        shown={view.length} total={rows.length}
        filters={[
          { label: "Security", value: sec, onChange: setSec,
            options: choices("Any security", rows.map((r) => r.symbol)) },
          { label: "Side", value: side, onChange: setSide,
            options: choices("Buy and sell", rows.map((r) => r.side)) },
          { label: "Status", value: status, onChange: setStatus,
            options: choices("Any status", rows.map((r) => r.status)) },
        ]}
        onCsv={() => downloadCsv("dse-orders",
          ["placed", "shareholder", "email", "side", "security", "quantity", "price_tzs",
           "consideration_tzs", "status", "settled", "tx_hash", "order_id"],
          view.map((r) => [r.createdAt, r.name, r.email, r.side, r.symbol, r.qty, r.price,
            r.amountTzs, r.status, r.settledAt, r.txHash, r.id]))}
      />
      <Table sort={sort} onSort={toggle} empty="No orders match that."
        cols={[
          { key: "created", label: "Placed" }, { key: "who", label: "Shareholder" },
          { key: "side", label: "Side" }, { key: "symbol", label: "Security" },
          { key: "qty", label: "Quantity", align: "right" },
          { key: "price", label: "Price", align: "right" },
          { key: "amount", label: "Consideration", align: "right" },
          { key: "status", label: "Status" }, { label: "Transaction" },
        ]}>
        {view.map((t) => (
          <Row key={t.id}>
            <Td className="whitespace-nowrap">{when(t.createdAt)}</Td>
            <Td>
              <button onClick={() => onOpen(t.userId)}
                className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid">
                {t.name ?? t.email}
              </button>
              <div className="mt-0.5"><Pill tone={kycTone(t.kycStatus)}>{t.kycStatus}</Pill></div>
            </Td>
            <Td className={t.side === "buy" ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
              {t.side}
            </Td>
            <Td className="font-medium">{t.symbol}</Td>
            <Td align="right" className="tnum">{t.qty === null ? "—" : qty(t.qty)}</Td>
            <Td align="right" className="tnum">{t.price === null ? "—" : tzs(t.price)}</Td>
            <Td align="right" className="tnum">{t.amountTzs === null ? "—" : tzs(t.amountTzs)}</Td>
            <Td>
              <Pill tone={statusTone(t.status)}>{t.status}</Pill>
              {t.error && <div className="mt-1 text-[11px] text-[var(--color-down)]">{t.error}</div>}
              {t.settledAt && (
                <div className="mt-1 whitespace-nowrap text-[11px] text-[var(--muted)]">
                  {when(t.settledAt)}
                </div>
              )}
            </Td>
            <Td><Tx hash={t.txHash} /></Td>
          </Row>
        ))}
      </Table>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function CustodyTab({ c, securities }: { c: Custody; securities: Security[] }) {
  const [q, setQ] = useState("");
  const [sec, setSec] = useState("");
  const [force, setForce] = useState("");
  const att = useSort({ key: "issued", dir: "desc" });
  const iss = useSort({ key: "created", dir: "desc" });

  const chainOf = (symbol: string) =>
    securities.find((s) => s.symbol === symbol)?.chainId;

  const aSearched = useSearch(c.attestations, q, (r) => [r.security, r.custodian, r.docRef, r.signer, r.approvedBy]);
  const aFiltered = aSearched.filter((r) =>
    (!sec || r.security === sec) &&
    (!force || (force === "fresh" ? r.fresh : !r.fresh)));
  const aView = sorted(aFiltered, att.sort, (r, k) => ({
    security: r.security, custodian: r.custodian, quantity: r.quantity, locked: r.locked,
    issued: r.issuedAt, expires: r.expiresAt, status: r.status,
  }[k]));

  const iSearched = useSearch(c.issuance, q, (r) => [r.security, r.kind, r.actor, r.txHash]);
  const iFiltered = iSearched.filter((r) => !sec || r.security === sec);
  const iView = sorted(iFiltered, iss.sort, (r, k) => ({
    created: r.createdAt, security: r.security, kind: r.kind, quantity: r.quantity, by: r.actor,
  }[k]));

  return (
    <section className="mt-6 grid gap-10">
      <div>
        <h2 className="text-sm font-medium">Custody attestations</h2>
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          What the custodian confirms holding, and how much of it is earmarked against tokens
          CAPX has issued. An expired attestation backs nothing and is shown rather than hidden.
        </p>
        <Toolbar
          q={q} onQ={setQ} placeholder="Search security, custodian, reference or signer…"
          shown={aView.length} total={c.attestations.length}
          filters={[
            { label: "Security", value: sec, onChange: setSec,
              options: choices("Any security", c.attestations.map((r) => r.security)) },
            { label: "In force", value: force, onChange: setForce,
              options: [{ label: "In force and expired", value: "" },
                        { label: "In force only", value: "fresh" },
                        { label: "Expired only", value: "stale" }] },
          ]}
          onCsv={() => downloadCsv("dse-attestations",
            ["security", "custodian", "held", "locked", "filed", "expires", "in_force",
             "status", "approved_by", "approved_at", "reference", "signer"],
            aView.map((a) => [a.security, a.custodian, a.quantity, a.locked, a.issuedAt,
              a.expiresAt, a.fresh ? "yes" : "no", a.status, a.approvedBy, a.approvedAt,
              a.docRef, a.signer]))}
        />
        <Table sort={att.sort} onSort={att.toggle} empty="No attestations match that."
          cols={[
            { key: "security", label: "Security" }, { key: "custodian", label: "Custodian" },
            { key: "quantity", label: "Held", align: "right" },
            { key: "locked", label: "Locked", align: "right" },
            { key: "issued", label: "Filed" }, { key: "expires", label: "Expires" },
            { key: "status", label: "Status" }, { label: "Approved by" }, { label: "Reference" },
          ]}>
          {aView.map((a) => (
            <Row key={a.id}>
              <Td className="font-medium">{a.security}</Td>
              <Td>{a.custodian}</Td>
              <Td align="right" className="tnum">{qty(a.quantity)}</Td>
              <Td align="right" className="tnum">{qty(a.locked)}</Td>
              <Td className="whitespace-nowrap">{day(a.issuedAt)}</Td>
              <Td><Pill tone={a.fresh ? "ok" : "bad"}>{day(a.expiresAt)}</Pill></Td>
              <Td><Pill tone={statusTone(a.status)}>{a.status}</Pill></Td>
              <Td>
                {a.approvedBy ?? "—"}
                <div className="text-[11px] text-[var(--muted)]">{day(a.approvedAt)}</div>
                {a.signer && <div className="text-[11px] text-[var(--muted)]">signed {a.signer}</div>}
              </Td>
              <Td className="text-[11px] break-all">{a.docRef ?? "—"}</Td>
            </Row>
          ))}
        </Table>
      </div>

      <div>
        <h2 className="text-sm font-medium">Issuance</h2>
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          Every token minted and burned against those attestations. Each transaction links to
          the chain, where the quantity and the recipient can be checked independently of
          anything CAPX says here.
        </p>
        <Toolbar
          q={q} onQ={setQ} placeholder="Search security, action, actor or hash…"
          shown={iView.length} total={c.issuance.length}
          filters={[{ label: "Security", value: sec, onChange: setSec,
            options: choices("Any security", c.issuance.map((r) => r.security)) }]}
          onCsv={() => downloadCsv("dse-issuance",
            ["when", "security", "action", "quantity", "by", "tx_hash"],
            iView.map((i) => [i.createdAt, i.security, i.kind, i.quantity, i.actor, i.txHash]))}
        />
        <Table sort={iss.sort} onSort={iss.toggle} empty="No issuance matches that."
          cols={[
            { key: "created", label: "When" }, { key: "security", label: "Security" },
            { key: "kind", label: "Action" }, { key: "quantity", label: "Quantity", align: "right" },
            { key: "by", label: "By" }, { label: "Transaction" },
          ]}>
          {iView.map((i) => (
            <Row key={i.id}>
              <Td className="whitespace-nowrap">{when(i.createdAt)}</Td>
              <Td className="font-medium">{i.security}</Td>
              <Td>
                <Pill tone={i.kind === "mint" ? "ok" : "warn"}>{i.kind}</Pill>
              </Td>
              <Td align="right" className="tnum">{qty(i.quantity)}</Td>
              <Td>{i.actor ?? "—"}</Td>
              <Td><Tx hash={i.txHash} chainId={chainOf(i.security)} /></Td>
            </Row>
          ))}
        </Table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function MoneyTab({ m }: { m: Money }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const dep = useSort({ key: "created", dir: "desc" });
  const wit = useSort({ key: "created", dir: "desc" });

  const dSearched = useSearch(m.deposits, q,
    (r) => [r.name, r.email, r.reference, r.route, r.fundingTx, r.transferTx, r.id]);
  const dView = sorted(dSearched.filter((r) => !status || r.status === status), dep.sort,
    (r, k) => ({ created: r.createdAt, who: r.name ?? r.email, amount: r.amountTzs,
                 route: r.route, status: r.status, settled: r.settledAt }[k]));

  const wSearched = useSearch(m.withdrawals, q, (r) => [r.name, r.email, r.destination, r.id]);
  const wView = sorted(wSearched.filter((r) => !status || r.status === status), wit.sort,
    (r, k) => ({ created: r.createdAt, who: r.name ?? r.email, amount: r.amountTzs,
                 status: r.status, sent: r.sentAt }[k]));

  const totalFee = m.fees.reduce((n, f) => n + f.feeTzs, 0);
  const totalCons = m.fees.reduce((n, f) => n + f.considerationTzs, 0);

  /* The destination is stored as JSON. Shown as something a person reads,
     with the raw value still on the row for anybody who wants it. */
  const destination = (raw: string) => {
    try {
      const d = JSON.parse(raw) as Record<string, unknown>;
      if (d.phone) return `mobile money · ${String(d.phone)}`;
      if (d.account_number) return `bank ${String(d.bank_code ?? "")} · ${String(d.account_number)}`;
      if (d.to_address) return `wallet · ${String(d.to_address)}`;
      return raw;
    } catch { return raw; }
  };

  return (
    <section className="mt-6 grid gap-10">
      <div>
        <h2 className="text-sm font-medium">Fees charged, by security</h2>
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          {m.split.totalBps} bps of consideration, split {m.split.brokerBps} to the broker and{" "}
          {m.split.capxBps} to CAPX. The split is a rate, so the last two columns are that rate
          applied to what was charged rather than separately banked figures.
        </p>
        <Table cols={[
          { label: "Security" }, { label: "Settled trades", align: "right" },
          { label: "Consideration (TZS)", align: "right" }, { label: "Fees (TZS)", align: "right" },
          { label: "Broker", align: "right" }, { label: "CAPX", align: "right" },
        ]} empty="No fees charged yet.">
          {m.fees.map((f) => (
            <Row key={f.security}>
              <Td className="font-medium">{f.security}</Td>
              <Td align="right" className="tnum">{f.trades}</Td>
              <Td align="right" className="tnum">{tzs(f.considerationTzs)}</Td>
              <Td align="right" className="tnum">{tzs(f.feeTzs)}</Td>
              <Td align="right" className="tnum">{tzs(f.brokerTzs)}</Td>
              <Td align="right" className="tnum">{tzs(f.capxTzs)}</Td>
            </Row>
          ))}
          {m.fees.length > 1 && (
            <Row key="__total">
              <Td className="font-medium">All</Td>
              <Td align="right" className="tnum">{m.fees.reduce((n, f) => n + f.trades, 0)}</Td>
              <Td align="right" className="tnum">{tzs(totalCons)}</Td>
              <Td align="right" className="tnum">{tzs(totalFee)}</Td>
              <Td align="right" className="tnum">{tzs(m.fees.reduce((n, f) => n + f.brokerTzs, 0))}</Td>
              <Td align="right" className="tnum">{tzs(m.fees.reduce((n, f) => n + f.capxTzs, 0))}</Td>
            </Row>
          )}
        </Table>
      </div>

      <div>
        <h2 className="text-sm font-medium">Deposits</h2>
        <Toolbar
          q={q} onQ={setQ} placeholder="Search shareholder, reference, route or hash…"
          shown={dView.length} total={m.deposits.length}
          filters={[{ label: "Status", value: status, onChange: setStatus,
            options: choices("Any status",
              [...m.deposits.map((r) => r.status), ...m.withdrawals.map((r) => r.status)]) }]}
          onCsv={() => downloadCsv("dse-deposits",
            ["when", "shareholder", "email", "amount_tzs", "route", "status", "reference",
             "funding_tx", "transfer_tx", "settled", "deposit_id"],
            dView.map((d) => [d.createdAt, d.name, d.email, d.amountTzs, d.route, d.status,
              d.reference, d.fundingTx, d.transferTx, d.settledAt, d.id]))}
        />
        <Table sort={dep.sort} onSort={dep.toggle} empty="No deposits match that."
          cols={[
            { key: "created", label: "When" }, { key: "who", label: "Shareholder" },
            { key: "amount", label: "Amount (TZS)", align: "right" },
            { key: "route", label: "Route" }, { key: "status", label: "Status" },
            { label: "Reference" }, { label: "On chain" },
          ]}>
          {dView.map((d) => (
            <Row key={d.id}>
              <Td className="whitespace-nowrap">{when(d.createdAt)}</Td>
              <Td>{d.name ?? d.email}</Td>
              <Td align="right" className="tnum">{tzs(d.amountTzs)}</Td>
              <Td>{d.route ?? "—"}</Td>
              <Td>
                <Pill tone={statusTone(d.status)}>{d.status}</Pill>
                {d.settledAt && (
                  <div className="mt-1 whitespace-nowrap text-[11px] text-[var(--muted)]">
                    {when(d.settledAt)}
                  </div>
                )}
              </Td>
              <Td className="text-[11px] break-all">{d.reference ?? "—"}</Td>
              <Td>
                {d.fundingTx && <div><Tx hash={d.fundingTx} label={`in ${d.fundingTx.slice(0, 8)}…`} /></div>}
                {d.transferTx && <div><Tx hash={d.transferTx} label={`sweep ${d.transferTx.slice(0, 8)}…`} /></div>}
                {!d.fundingTx && !d.transferTx && <span className="text-[var(--muted)]">—</span>}
              </Td>
            </Row>
          ))}
        </Table>
      </div>

      <div>
        <h2 className="text-sm font-medium">Withdrawals</h2>
        <Toolbar
          q={q} onQ={setQ} placeholder="Search shareholder or destination…"
          shown={wView.length} total={m.withdrawals.length}
          onCsv={() => downloadCsv("dse-withdrawals",
            ["when", "shareholder", "email", "amount_tzs", "status", "destination", "sent",
             "withdrawal_id"],
            wView.map((w) => [w.createdAt, w.name, w.email, w.amountTzs, w.status,
              w.destination, w.sentAt, w.id]))}
        />
        <Table sort={wit.sort} onSort={wit.toggle} empty="No withdrawals match that."
          cols={[
            { key: "created", label: "When" }, { key: "who", label: "Shareholder" },
            { key: "amount", label: "Amount (TZS)", align: "right" },
            { label: "Destination" }, { key: "status", label: "Status" },
            { key: "sent", label: "Sent" },
          ]}>
          {wView.map((w) => (
            <Row key={w.id}>
              <Td className="whitespace-nowrap">{when(w.createdAt)}</Td>
              <Td>{w.name ?? w.email}</Td>
              <Td align="right" className="tnum">{tzs(w.amountTzs)}</Td>
              <Td className="text-[11.5px] break-all">{destination(w.destination)}</Td>
              <Td><Pill tone={statusTone(w.status)}>{w.status}</Pill></Td>
              <Td className="whitespace-nowrap">{when(w.sentAt)}</Td>
            </Row>
          ))}
        </Table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function AccessTab({ rows }: { rows: Access[] }) {
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const { sort, toggle } = useSort({ key: "created", dir: "desc" });

  const searched = useSearch(rows, q,
    (r) => [r.actor, r.action, r.subject, r.ip, JSON.stringify(r.detail)]);
  const filtered = searched.filter((r) =>
    (!actor || r.actor === actor) && (!action || r.action === action));
  const view = sorted(filtered, sort, (r, k) => ({
    created: r.createdAt, actor: r.actor, action: r.action, subject: r.subject,
  }[k]));

  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium">Access log</h2>
      <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[var(--muted)]">
        Every time a shareholder&apos;s file or an identity document is opened on this portal,
        by anyone, it is recorded here. Aggregate pages are not logged — a row saying somebody
        read a table of totals would bury the rows that name a person.
      </p>
      <Toolbar
        q={q} onQ={setQ} placeholder="Search actor, action, subject or address…"
        shown={view.length} total={rows.length}
        filters={[
          { label: "Who", value: actor, onChange: setActor,
            options: choices("Anyone", rows.map((r) => r.actor)) },
          { label: "What", value: action, onChange: setAction,
            options: choices("Any action", rows.map((r) => r.action)) },
        ]}
        onCsv={() => downloadCsv("dse-access-log",
          ["when", "actor", "action", "subject", "detail", "ip"],
          view.map((a) => [a.createdAt, a.actor, a.action, a.subject,
            JSON.stringify(a.detail), a.ip]))}
      />
      <Table sort={sort} onSort={toggle} empty="Nothing has been opened yet."
        cols={[
          { key: "created", label: "When" }, { key: "actor", label: "Who" },
          { key: "action", label: "What" }, { key: "subject", label: "Subject" },
          { label: "Detail" }, { label: "From" },
        ]}>
        {view.map((a) => (
          <Row key={a.id}>
            <Td className="whitespace-nowrap">{when(a.createdAt)}</Td>
            <Td><Pill tone="flat">{a.actor}</Pill></Td>
            <Td>{a.action}</Td>
            <Td className="tnum text-[11px] break-all">{a.subject ?? "—"}</Td>
            <Td className="text-[11px] break-all">
              {Object.keys(a.detail ?? {}).length
                ? Object.entries(a.detail).map(([k, v]) => (
                    <div key={k}><span className="text-[var(--muted)]">{k}</span> {String(v)}</div>
                  ))
                : "—"}
            </Td>
            <Td className="tnum text-[11px]">{a.ip ?? "—"}</Td>
          </Row>
        ))}
      </Table>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * One shareholder's file.
 *
 * A panel rather than a page, because the register is the thing being worked
 * through and losing your place in it to read one row is how a supervisor
 * ends up with twelve tabs open.
 */
function CustomerFile({ file, busy, token, onClose }: {
  file: File | null; busy: boolean; token: string; onClose: () => void;
}) {
  const [shown, setShown] = useState<{ id: string; which: "doc" | "selfie" } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-[760px] overflow-y-auto border-l hairline bg-[var(--bg)] p-5 sm:p-7">
        <div className="sticky -top-5 z-10 -mx-5 -mt-5 flex items-start justify-between gap-4 border-b hairline bg-[var(--bg)] px-5 pb-3 pt-5 sm:-mx-7 sm:-mt-7 sm:px-7 sm:pt-7">
          <div>
            <div className="eyebrow">Shareholder file</div>
            <h2 className="display mt-1.5 text-2xl">
              {busy ? "Opening…" : file?.user.name ?? file?.user.email ?? "—"}
            </h2>
          </div>
          <button onClick={onClose}
            className="rounded-full border hairline px-3 py-1 text-[12px] hover:surface">Close</button>
        </div>

        {file && (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border hairline p-4">
                <div className="eyebrow">Identity</div>
                <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                  <dt className="text-[var(--muted)]">Name</dt><dd>{file.user.name ?? "—"}</dd>
                  <dt className="text-[var(--muted)]">Email</dt><dd className="break-all">{file.user.email}</dd>
                  <dt className="text-[var(--muted)]">Phone</dt><dd>{file.user.phone ?? "—"}</dd>
                  <dt className="text-[var(--muted)]">Country</dt><dd>{file.user.country}</dd>
                  <dt className="text-[var(--muted)]">Document</dt><dd>{file.user.docType ?? "—"}</dd>
                  <dt className="text-[var(--muted)]">NIDA</dt>
                  <dd className="tnum break-all">{file.user.nida ?? "—"}</dd>
                  <dt className="text-[var(--muted)]">Joined</dt><dd>{day(file.user.joined)}</dd>
                  <dt className="text-[var(--muted)]">CAPX id</dt>
                  <dd className="tnum text-[11px] break-all">{file.user.userId}</dd>
                </dl>
              </div>
              <div className="rounded-2xl border hairline p-4">
                <div className="eyebrow">Verification</div>
                <div className="mt-2"><Pill tone={kycTone(file.user.kycStatus)}>{file.user.kycStatus}</Pill></div>
                <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                  <dt className="text-[var(--muted)]">Decided by</dt>
                  <dd>{file.user.kycSource ?? "CAPX"}</dd>
                  <dt className="text-[var(--muted)]">Attested by</dt>
                  <dd>{file.user.kycAttestedBy ?? "—"}</dd>
                  <dt className="text-[var(--muted)]">When</dt>
                  <dd>{when(file.user.kycAttestedAt)}</dd>
                </dl>
              </div>
            </div>

            <h3 className="mt-6 text-sm font-medium">Documents filed</h3>
            <div className="mt-2 grid gap-2">
              {file.documents.map((d) => (
                <div key={d.id} className="rounded-2xl border hairline p-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[13px] font-medium">
                      {d.docType} · <span className="tnum">{d.docNumber ?? "—"}</span>
                    </div>
                    <Pill tone={statusTone(d.status)}>{d.status}</Pill>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">
                    Filed {when(d.filedAt)}
                    {d.reviewedBy ? ` · reviewed by ${d.reviewedBy} ${when(d.reviewedAt)}` : ""}
                    {d.reason ? ` · ${d.reason}` : ""}
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    {(["doc", "selfie"] as const).map((w) => (
                      <button key={w}
                        onClick={() => setShown((s) =>
                          s?.id === d.id && s.which === w ? null : { id: d.id, which: w })}
                        className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                          shown?.id === d.id && shown.which === w
                            ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]"
                            : "hairline hover:surface"}`}>
                        {w === "doc" ? "View document" : "View selfie"}
                      </button>
                    ))}
                  </div>
                  {shown?.id === d.id && (() => {
                    /*
                     * Identity documents are not always pictures.
                     *
                     * A scanned ID is often filed as a PDF, and a PDF in an
                     * `<img>` renders as a broken image — which a supervisor
                     * would reasonably read as "CAPX does not have the
                     * document" rather than "this viewer cannot show it".
                     * The mime is on the record, so it is used.
                     */
                    const mime = shown.which === "doc" ? d.docMime : d.selfieMime;
                    const src = `/api/dse/document?id=${encodeURIComponent(d.id)}`
                      + `&which=${shown.which}&token=${encodeURIComponent(token)}`;
                    const label = shown.which === "doc" ? "Identity document" : "Selfie";
                    return (
                      <div className="mt-3">
                        {mime === "application/pdf" ? (
                          <object data={src} type="application/pdf" aria-label={label}
                            className="h-[480px] w-full rounded-xl border hairline">
                            <a href={src} className="text-[12px] underline underline-offset-2">
                              Open the {label.toLowerCase()} (PDF)
                            </a>
                          </object>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt={label}
                            className="max-h-[420px] w-full rounded-xl border hairline object-contain" />
                        )}
                        <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                          This view has been recorded in the access log.
                        </p>
                      </div>
                    );
                  })()}
                </div>
              ))}
              {!file.documents.length && (
                <p className="text-[12px] text-[var(--muted)]">No documents on file.</p>
              )}
            </div>

            <h3 className="mt-6 text-sm font-medium">Holdings</h3>
            <Table cols={[
              { label: "Security" }, { label: "Held", align: "right" },
              { label: "Bought", align: "right" }, { label: "Sold", align: "right" },
            ]} empty="None.">
              {file.positions.map((p) => (
                <Row key={p.symbol}>
                  <Td className="font-medium">{p.symbol}</Td>
                  <Td align="right" className="tnum">{qty(p.qty)}</Td>
                  <Td align="right" className="tnum">{qty(p.bought)}</Td>
                  <Td align="right" className="tnum">{qty(p.sold)}</Td>
                </Row>
              ))}
            </Table>

            <h3 className="mt-6 text-sm font-medium">Orders</h3>
            <Table cols={[
              { label: "When" }, { label: "Side" }, { label: "Security" },
              { label: "Quantity", align: "right" }, { label: "Price", align: "right" },
              { label: "TZS", align: "right" }, { label: "Status" }, { label: "Transaction" },
            ]} empty="None.">
              {file.orders.map((t) => (
                <Row key={t.id}>
                  <Td className="whitespace-nowrap">{when(t.createdAt)}</Td>
                  <Td>{t.side}</Td>
                  <Td className="font-medium">{t.symbol}</Td>
                  <Td align="right" className="tnum">{t.qty === null ? "—" : qty(t.qty)}</Td>
                  <Td align="right" className="tnum">{t.price === null ? "—" : tzs(t.price)}</Td>
                  <Td align="right" className="tnum">{t.amountTzs === null ? "—" : tzs(t.amountTzs)}</Td>
                  <Td><Pill tone={statusTone(t.status)}>{t.status}</Pill></Td>
                  <Td><Tx hash={t.txHash} /></Td>
                </Row>
              ))}
            </Table>

            <h3 className="mt-6 text-sm font-medium">Money</h3>
            <Table cols={[
              { label: "When" }, { label: "Kind" }, { label: "Amount (TZS)", align: "right" },
              { label: "Status" }, { label: "Detail" }, { label: "On chain" },
            ]} empty="None.">
              {[
                ...file.deposits.map((d) => ({ ...d, kind: "deposit" as const })),
                ...file.withdrawals.map((w) => ({ ...w, kind: "withdrawal" as const })),
              ]
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .map((r) => (
                  <Row key={r.id}>
                    <Td className="whitespace-nowrap">{when(r.createdAt)}</Td>
                    <Td>{r.kind}</Td>
                    <Td align="right" className="tnum">{tzs(r.amountTzs)}</Td>
                    <Td><Pill tone={statusTone(r.status)}>{r.status}</Pill></Td>
                    <Td className="text-[11px] break-all">
                      {"destination" in r ? r.destination : [r.route, r.reference].filter(Boolean).join(" · ") || "—"}
                    </Td>
                    <Td>
                      {"fundingTx" in r && (r.fundingTx || r.transferTx)
                        ? <>
                            {r.fundingTx && <div><Tx hash={r.fundingTx} /></div>}
                            {r.transferTx && <div><Tx hash={r.transferTx} /></div>}
                          </>
                        : <span className="text-[var(--muted)]">—</span>}
                    </Td>
                  </Row>
                ))}
            </Table>

            <h3 className="mt-6 text-sm font-medium">Ledger</h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">
              The entries every other figure in this file is derived from, in shares and
              shillings.
            </p>
            <Table cols={[
              { label: "When" }, { label: "Kind" }, { label: "Asset" },
              { label: "Amount", align: "right" }, { label: "Reference" },
            ]} empty="None.">
              {file.ledger.map((l) => (
                <Row key={l.id}>
                  <Td className="whitespace-nowrap">{when(l.createdAt)}</Td>
                  <Td>{l.kind}</Td>
                  <Td className="font-medium">{l.asset}</Td>
                  <Td align="right"
                    className={`tnum ${l.amount < 0 ? "text-[var(--color-down)]" : ""}`}>
                    {l.asset === "TZS" ? tzs(l.amount) : qty(l.amount)}
                  </Td>
                  <Td className="tnum text-[11px] break-all">{l.ref ?? "—"}</Td>
                </Row>
              ))}
            </Table>
          </>
        )}
      </div>
    </div>
  );
}
