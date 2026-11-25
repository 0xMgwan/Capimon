"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The exchange's portal onto CAPX's Dar es Salaam book.
 *
 * Built to be read by somebody whose job is to check, not to trade, so it is
 * laid out as a filing cabinet rather than a dashboard: the register, the
 * blotter, the custody file, the money, and the log of who opened what. Every
 * number on it is live from the same tables CAPX and the customer read.
 *
 * Two deliberate absences. There is nothing to click that changes anything,
 * because the token behind it cannot change anything and a disabled control
 * is just a worse way of saying so. And there is no US security anywhere —
 * not greyed out, not filtered in the browser, simply never sent.
 *
 * The token lives in React state and is never written to storage. A
 * supervisory credential left in localStorage outlives the person's attention
 * and the browser session, and this one opens identity documents.
 */

type Position = { symbol: string; qty: number };

type Overview = {
  securities: { symbol: string; name: string; token: string | null; status: string;
                holders: number; held: number; custodian: string | null; locked: number | null;
                attestationExpires: string | null; fresh: boolean }[];
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
              reference: string | null; createdAt: string; settledAt: string | null }[];
  withdrawals: { id: string; amountTzs: number; status: string; destination: string;
                 createdAt: string; sentAt: string | null }[];
};

const TABS = [
  ["overview", "Overview"], ["register", "Register"], ["orders", "Orders"],
  ["custody", "Custody"], ["money", "Money"], ["access", "Access log"],
] as const;
type Tab = (typeof TABS)[number][0];

const tzs = (n: number) => `${Math.round(n).toLocaleString()}`;
const qty = (n: number) => (Math.abs(n) >= 1 ? n.toFixed(2) : n.toFixed(4));
const when = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
const day = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "—";

function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "flat"; children: React.ReactNode }) {
  const c = tone === "ok" ? "var(--color-up)" : tone === "bad" ? "var(--color-down)"
    : tone === "warn" ? "var(--color-accent)" : "var(--muted)";
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color: c, borderColor: c }}>{children}</span>
  );
}

const kycTone = (s: string) =>
  s === "approved" ? "ok" : s === "pending" ? "warn" : "bad";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border hairline p-4">
      <div className="eyebrow leading-tight">{label}</div>
      <div className="tnum mt-1.5 text-xl font-medium">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl border hairline">
      <table className="w-full min-w-[640px] text-left text-[12.5px]">
        <thead>
          <tr className="surface">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <td className={`border-t hairline px-3 py-2 align-top ${className}`}>{children}</td>
);

export function DseOversight() {
  const [token, setToken] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileBusy, setFileBusy] = useState(false);

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
    setFileBusy(true); setFile(null);
    try {
      const r = await fetch(
        `/api/dse/customer?id=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`,
        { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not open that file.");
      setFile(j as File);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open that file.");
    } finally {
      setFileBusy(false);
    }
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

  const o = book.overview;

  return (
    <div className="mx-auto max-w-[1300px] px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="eyebrow">Dar es Salaam Stock Exchange · oversight</div>
          <h1 className="display mt-2 text-3xl">The CAPX book.</h1>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <Pill tone="flat">{book.actor}</Pill>
          {book.readOnly && <Pill tone="flat">read-only</Pill>}
          <button onClick={() => void load(token)} className="underline underline-offset-2">
            {busy ? "refreshing…" : "refresh"}
          </button>
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
        DSE-listed securities only. Nothing on this page includes a US-listed share, a dollar
        balance, or a customer who has never held a Dar es Salaam security — those are not sent
        to this portal rather than hidden on it.
      </p>

      <div className="mt-6 flex flex-wrap gap-1.5">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              tab === id ? "bg-[var(--fg)] text-[var(--bg)]" : "border hairline hover:surface"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {err && <p className="mt-4 text-xs text-[var(--color-down)]">{err}</p>}

      {tab === "overview" && (
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
          <Table head={["Security", "Status", "Holders", "Held by customers", "Custodian",
                        "Attested locked", "Attestation"]}>
            {o.securities.map((s) => (
              <tr key={s.symbol}>
                <Td>
                  <div className="font-medium">{s.symbol}</div>
                  <div className="text-[11px] text-[var(--muted)]">{s.name}</div>
                </Td>
                <Td>{s.status}</Td>
                <Td className="tnum">{s.holders}</Td>
                <Td className="tnum">{qty(s.held)}</Td>
                <Td>{s.custodian ?? <span className="text-[var(--muted)]">—</span>}</Td>
                <Td className="tnum">{s.locked === null ? "—" : qty(s.locked)}</Td>
                <Td>
                  {s.attestationExpires
                    ? <Pill tone={s.fresh ? "ok" : "bad"}>
                        {s.fresh ? `valid to ${day(s.attestationExpires)}`
                                 : `expired ${day(s.attestationExpires)}`}
                      </Pill>
                    : <Pill tone="bad">none in force</Pill>}
                </Td>
              </tr>
            ))}
            {!o.securities.length && (
              <tr><Td className="text-[var(--muted)]">No DSE securities are listed yet.</Td></tr>
            )}
          </Table>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            &ldquo;Attested locked&rdquo; is what the custodian confirms is earmarked against
            tokens. An expired attestation backs nothing and is shown as expired rather than
            left out.
          </p>
        </section>
      )}

      {tab === "register" && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">
            Shareholder register · {book.register.length.toLocaleString()}
          </h2>
          <Table head={["Shareholder", "Contact", "Verification", "Holdings", "Trades",
                        "Cash (TZS)", "Joined", ""]}>
            {book.register.map((r) => (
              <tr key={r.userId}>
                <Td>
                  <div className="font-medium">{r.name ?? "—"}</div>
                  <div className="text-[11px] text-[var(--muted)]">{r.country}</div>
                </Td>
                <Td>
                  <div>{r.email}</div>
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
                        <div key={p.symbol}>{p.symbol} {qty(p.qty)}</div>
                      ))
                    : <span className="text-[var(--muted)]">—</span>}
                </Td>
                <Td className="tnum">
                  {r.trades}
                  <div className="text-[11px] text-[var(--muted)]">{day(r.lastTrade)}</div>
                </Td>
                <Td className="tnum">{tzs(r.cashTzs)}</Td>
                <Td>{day(r.joined)}</Td>
                <Td>
                  <button onClick={() => void openFile(r.userId)}
                    className="whitespace-nowrap rounded-full border hairline px-3 py-1 text-[11px] font-medium hover:surface">
                    Open file
                  </button>
                </Td>
              </tr>
            ))}
            {!book.register.length && (
              <tr><Td className="text-[var(--muted)]">Nobody holds a DSE security yet.</Td></tr>
            )}
          </Table>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            Opening a file is recorded against this token.
          </p>
        </section>
      )}

      {tab === "orders" && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">Order blotter · last {book.orders.length}</h2>
          <Table head={["When", "Shareholder", "Side", "Security", "Quantity", "Price",
                        "Consideration", "Status", "Settled"]}>
            {book.orders.map((t) => (
              <tr key={t.id}>
                <Td className="whitespace-nowrap">{when(t.createdAt)}</Td>
                <Td>
                  <div>{t.name ?? t.email}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    <Pill tone={kycTone(t.kycStatus)}>{t.kycStatus}</Pill>
                  </div>
                </Td>
                <Td className={t.side === "buy" ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
                  {t.side}
                </Td>
                <Td className="font-medium">{t.symbol}</Td>
                <Td className="tnum">{t.qty === null ? "—" : qty(t.qty)}</Td>
                <Td className="tnum">{t.price === null ? "—" : tzs(t.price)}</Td>
                <Td className="tnum">{t.amountTzs === null ? "—" : tzs(t.amountTzs)}</Td>
                <Td>
                  <Pill tone={t.status === "settled" ? "ok" : t.status === "failed" ? "bad" : "warn"}>
                    {t.status}
                  </Pill>
                  {t.error && <div className="mt-1 text-[11px] text-[var(--color-down)]">{t.error}</div>}
                </Td>
                <Td className="whitespace-nowrap">{when(t.settledAt)}</Td>
              </tr>
            ))}
            {!book.orders.length && (
              <tr><Td className="text-[var(--muted)]">No orders yet.</Td></tr>
            )}
          </Table>
        </section>
      )}

      {tab === "custody" && (
        <section className="mt-6 grid gap-8">
          <div>
            <h2 className="text-sm font-medium">Custody attestations</h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              What the custodian confirms holding, and how much of it is earmarked against
              tokens CAPX has issued.
            </p>
            <Table head={["Security", "Custodian", "Held", "Locked", "Filed", "Expires",
                          "Status", "Approved by", "Reference"]}>
              {book.custody.attestations.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">{a.security}</Td>
                  <Td>{a.custodian}</Td>
                  <Td className="tnum">{qty(a.quantity)}</Td>
                  <Td className="tnum">{qty(a.locked)}</Td>
                  <Td>{day(a.issuedAt)}</Td>
                  <Td><Pill tone={a.fresh ? "ok" : "bad"}>{day(a.expiresAt)}</Pill></Td>
                  <Td>{a.status}</Td>
                  <Td>
                    {a.approvedBy ?? "—"}
                    <div className="text-[11px] text-[var(--muted)]">{day(a.approvedAt)}</div>
                  </Td>
                  <Td className="text-[11px]">{a.docRef ?? "—"}</Td>
                </tr>
              ))}
              {!book.custody.attestations.length && (
                <tr><Td className="text-[var(--muted)]">No attestations filed.</Td></tr>
              )}
            </Table>
          </div>

          <div>
            <h2 className="text-sm font-medium">Issuance</h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              Every token minted and burned against those attestations, on chain.
            </p>
            <Table head={["When", "Security", "Action", "Quantity", "By", "Transaction"]}>
              {book.custody.issuance.map((i) => (
                <tr key={i.id}>
                  <Td className="whitespace-nowrap">{when(i.createdAt)}</Td>
                  <Td className="font-medium">{i.security}</Td>
                  <Td>{i.kind}</Td>
                  <Td className="tnum">{qty(i.quantity)}</Td>
                  <Td>{i.actor ?? "—"}</Td>
                  <Td className="text-[11px] break-all">{i.txHash ?? "—"}</Td>
                </tr>
              ))}
              {!book.custody.issuance.length && (
                <tr><Td className="text-[var(--muted)]">Nothing issued yet.</Td></tr>
              )}
            </Table>
          </div>
        </section>
      )}

      {tab === "money" && (
        <section className="mt-6 grid gap-8">
          <div>
            <h2 className="text-sm font-medium">Fees charged, by security</h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {book.money.split.totalBps} bps of consideration, split{" "}
              {book.money.split.brokerBps} to the broker and {book.money.split.capxBps} to CAPX.
              The split is a rate, so the two columns are that rate applied to what was charged
              rather than separately banked figures.
            </p>
            <Table head={["Security", "Settled trades", "Consideration (TZS)", "Fees (TZS)",
                          "Broker", "CAPX"]}>
              {book.money.fees.map((f) => (
                <tr key={f.security}>
                  <Td className="font-medium">{f.security}</Td>
                  <Td className="tnum">{f.trades}</Td>
                  <Td className="tnum">{tzs(f.considerationTzs)}</Td>
                  <Td className="tnum">{tzs(f.feeTzs)}</Td>
                  <Td className="tnum">{tzs(f.brokerTzs)}</Td>
                  <Td className="tnum">{tzs(f.capxTzs)}</Td>
                </tr>
              ))}
              {!book.money.fees.length && (
                <tr><Td className="text-[var(--muted)]">No fees charged yet.</Td></tr>
              )}
            </Table>
          </div>

          <div>
            <h2 className="text-sm font-medium">Deposits · last {book.money.deposits.length}</h2>
            <Table head={["When", "Shareholder", "Amount (TZS)", "Route", "Status",
                          "Reference", "Settled"]}>
              {book.money.deposits.map((d) => (
                <tr key={d.id}>
                  <Td className="whitespace-nowrap">{when(d.createdAt)}</Td>
                  <Td>{d.name ?? d.email}</Td>
                  <Td className="tnum">{tzs(d.amountTzs)}</Td>
                  <Td>{d.route ?? "—"}</Td>
                  <Td>
                    <Pill tone={d.status === "settled" ? "ok" : d.status === "failed" ? "bad" : "warn"}>
                      {d.status}
                    </Pill>
                  </Td>
                  <Td className="text-[11px] break-all">{d.reference ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{when(d.settledAt)}</Td>
                </tr>
              ))}
              {!book.money.deposits.length && (
                <tr><Td className="text-[var(--muted)]">No deposits yet.</Td></tr>
              )}
            </Table>
          </div>

          <div>
            <h2 className="text-sm font-medium">Withdrawals · last {book.money.withdrawals.length}</h2>
            <Table head={["When", "Shareholder", "Amount (TZS)", "Destination", "Status", "Sent"]}>
              {book.money.withdrawals.map((w) => (
                <tr key={w.id}>
                  <Td className="whitespace-nowrap">{when(w.createdAt)}</Td>
                  <Td>{w.name ?? w.email}</Td>
                  <Td className="tnum">{tzs(w.amountTzs)}</Td>
                  <Td className="text-[11px] break-all">{w.destination}</Td>
                  <Td>
                    <Pill tone={w.status === "sent" ? "ok" : w.status === "failed" ? "bad" : "warn"}>
                      {w.status}
                    </Pill>
                  </Td>
                  <Td className="whitespace-nowrap">{when(w.sentAt)}</Td>
                </tr>
              ))}
              {!book.money.withdrawals.length && (
                <tr><Td className="text-[var(--muted)]">No withdrawals yet.</Td></tr>
              )}
            </Table>
          </div>
        </section>
      )}

      {tab === "access" && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">Access log · last {book.access.length}</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[var(--muted)]">
            Every time a shareholder&apos;s file or an identity document is opened on this
            portal, by anyone, it is recorded here. Aggregate pages are not logged — a row
            saying somebody read a table of totals would bury the rows that name a person.
          </p>
          <Table head={["When", "Who", "What", "Subject", "Detail", "From"]}>
            {book.access.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap">{when(a.createdAt)}</Td>
                <Td><Pill tone="flat">{a.actor}</Pill></Td>
                <Td>{a.action}</Td>
                <Td className="text-[11px] break-all">{a.subject ?? "—"}</Td>
                <Td className="text-[11px] break-all">
                  {Object.keys(a.detail ?? {}).length ? JSON.stringify(a.detail) : "—"}
                </Td>
                <Td className="text-[11px]">{a.ip ?? "—"}</Td>
              </tr>
            ))}
            {!book.access.length && (
              <tr><Td className="text-[var(--muted)]">Nothing has been opened yet.</Td></tr>
            )}
          </Table>
        </section>
      )}

      {(file || fileBusy) && (
        <CustomerFile file={file} busy={fileBusy} token={token} onClose={() => setFile(null)} />
      )}
    </div>
  );
}

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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-[720px] overflow-y-auto border-l hairline bg-[var(--bg)] p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Shareholder file</div>
            <h2 className="display mt-2 text-2xl">
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
                    <Pill tone={d.status === "approved" ? "ok" : d.status === "rejected" ? "bad" : "warn"}>
                      {d.status}
                    </Pill>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">
                    Filed {when(d.filedAt)}
                    {d.reviewedBy ? ` · reviewed by ${d.reviewedBy} ${when(d.reviewedAt)}` : ""}
                    {d.reason ? ` · ${d.reason}` : ""}
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    {(["doc", "selfie"] as const).map((w) => (
                      <button key={w} onClick={() => setShown({ id: d.id, which: w })}
                        className="rounded-full border hairline px-3 py-1 text-[11px] font-medium hover:surface">
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
            <Table head={["Security", "Held", "Bought", "Sold"]}>
              {file.positions.map((p) => (
                <tr key={p.symbol}>
                  <Td className="font-medium">{p.symbol}</Td>
                  <Td className="tnum">{qty(p.qty)}</Td>
                  <Td className="tnum">{qty(p.bought)}</Td>
                  <Td className="tnum">{qty(p.sold)}</Td>
                </tr>
              ))}
              {!file.positions.length && (
                <tr><Td className="text-[var(--muted)]">None.</Td></tr>
              )}
            </Table>

            <h3 className="mt-6 text-sm font-medium">Orders</h3>
            <Table head={["When", "Side", "Security", "Quantity", "Price", "TZS", "Status"]}>
              {file.orders.map((t) => (
                <tr key={t.id}>
                  <Td className="whitespace-nowrap">{when(t.createdAt)}</Td>
                  <Td>{t.side}</Td>
                  <Td className="font-medium">{t.symbol}</Td>
                  <Td className="tnum">{t.qty === null ? "—" : qty(t.qty)}</Td>
                  <Td className="tnum">{t.price === null ? "—" : tzs(t.price)}</Td>
                  <Td className="tnum">{t.amountTzs === null ? "—" : tzs(t.amountTzs)}</Td>
                  <Td>{t.status}</Td>
                </tr>
              ))}
              {!file.orders.length && <tr><Td className="text-[var(--muted)]">None.</Td></tr>}
            </Table>

            <h3 className="mt-6 text-sm font-medium">Money</h3>
            <Table head={["When", "Kind", "Amount (TZS)", "Status", "Detail"]}>
              {file.deposits.map((d) => (
                <tr key={d.id}>
                  <Td className="whitespace-nowrap">{when(d.createdAt)}</Td>
                  <Td>deposit</Td>
                  <Td className="tnum">{tzs(d.amountTzs)}</Td>
                  <Td>{d.status}</Td>
                  <Td className="text-[11px] break-all">{d.route ?? ""} {d.reference ?? ""}</Td>
                </tr>
              ))}
              {file.withdrawals.map((w) => (
                <tr key={w.id}>
                  <Td className="whitespace-nowrap">{when(w.createdAt)}</Td>
                  <Td>withdrawal</Td>
                  <Td className="tnum">{tzs(w.amountTzs)}</Td>
                  <Td>{w.status}</Td>
                  <Td className="text-[11px] break-all">{w.destination}</Td>
                </tr>
              ))}
              {!file.deposits.length && !file.withdrawals.length && (
                <tr><Td className="text-[var(--muted)]">None.</Td></tr>
              )}
            </Table>

            <h3 className="mt-6 text-sm font-medium">Ledger</h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">
              The entries every other figure in this file is derived from. Shares and shillings
              only; dollar entries belong to the other board and are not sent here.
            </p>
            <Table head={["When", "Kind", "Asset", "Amount", "Reference"]}>
              {file.ledger.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap">{when(l.createdAt)}</Td>
                  <Td>{l.kind}</Td>
                  <Td className="font-medium">{l.asset}</Td>
                  <Td className={`tnum ${l.amount < 0 ? "text-[var(--color-down)]" : ""}`}>
                    {l.asset === "TZS" ? tzs(l.amount) : qty(l.amount)}
                  </Td>
                  <Td className="text-[11px] break-all">{l.ref ?? "—"}</Td>
                </tr>
              ))}
              {!file.ledger.length && <tr><Td className="text-[var(--muted)]">None.</Td></tr>}
            </Table>
          </>
        )}
      </div>
    </div>
  );
}
