"use client";

import { useEffect, useState } from "react";
import { DseLogo } from "./DseLogo";
import { useDse, dseLogoOf } from "@/lib/useDse";

/**
 * The broker's own numbers, at the top of their portal.
 *
 * FIMCO's desk opened on a list of securities and a filing form: everything
 * CAPX needs from them, nothing they get back. What a counterparty actually
 * wants to know first is what the arrangement is earning them, which
 * securities are earning it, and whether the money has been paid — so that is
 * what the page opens on now, and the filing work sits below it.
 *
 * Charts are drawn here rather than pulled in: three dozen daily figures and
 * a handful of bars do not justify a charting library, and an SVG rect is
 * lighter than the theme wiring one would need.
 */
type Entry = {
  id: string; kind: string; amountTzs: number; security: string | null;
  note: string | null; createdBy: string | null; createdAt: string;
};

type Account = {
  balance: number;
  entries: Entry[];
  daily: { day: string; earned: number; trades: number }[];
  bySecurity: { security: string; earned: number; trades: number }[];
  split: { totalBps: number; brokerBps: number; capxBps: number };
};

const TZS = (n: number) => `${Math.round(n).toLocaleString()} TZS`;
const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${Math.round(n / 1_000)}k`
  : Math.round(n).toString();

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function FimcoOverview({ token, isAdmin }: { token: string; isAdmin: boolean }) {
  const [acct, setAcct] = useState<Account | null>(null);
  const [payout, setPayout] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const dse = useDse();

  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch("/api/admin/broker", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setAcct(j); })
      .catch(() => { /* the desk below still works */ });
    return () => { alive = false; };
  }, [token, reload]);

  const pay = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/broker", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ amountTzs: Number(payout), note: note || null }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not record the payout");
      setMsg(`Recorded. ${TZS(j.balance)} still owed.`);
      setPayout(""); setNote(""); setReload((n) => n + 1);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not record the payout");
    } finally {
      setBusy(false);
    }
  };

  if (!acct) {
    return (
      <section id="overview" className="mt-6 scroll-mt-24">
        <div className="h-40 animate-pulse rounded-3xl surface" />
      </section>
    );
  }

  const earned30 = acct.daily.reduce((s, d) => s + d.earned, 0);
  const trades30 = acct.daily.reduce((s, d) => s + d.trades, 0);
  const paid = acct.entries.filter((e) => e.kind === "payout").reduce((s, e) => s + Math.abs(e.amountTzs), 0);
  const peak = Math.max(1, ...acct.daily.map((d) => d.earned));
  const topSecurity = acct.bySecurity[0];

  return (
    <section id="overview" className="mt-6 scroll-mt-24">
      {/* The four figures a broker opens this page to see. */}
      <div className="grid gap-px overflow-hidden rounded-3xl bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Owed to you now" value={TZS(acct.balance)} tone="up"
          note={paid > 0 ? `${TZS(paid)} paid out so far` : "Nothing paid out yet"} />
        <Stat label="Earned · 30 days" value={TZS(earned30)}
          note={`${trades30.toLocaleString()} ${trades30 === 1 ? "trade" : "trades"}`} />
        <Stat label="Your share" value={`${(acct.split.brokerBps / 100).toFixed(2)}%`}
          note={`of a ${(acct.split.totalBps / 100).toFixed(2)}% trade fee`} />
        <Stat label="Best earner" value={topSecurity?.security ?? "—"}
          note={topSecurity ? `${TZS(topSecurity.earned)} from ${topSecurity.trades} trades` : "No trades yet"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Daily earnings. */}
        <div className="rounded-3xl border hairline p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="eyebrow">Fees earned</div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">Last 30 days, in shillings</div>
            </div>
            <div className="tnum text-2xl font-medium">{TZS(earned30)}</div>
          </div>

          {acct.daily.length === 0 ? (
            <p className="mt-8 text-center text-sm text-[var(--muted)]">
              Nothing yet. A bar appears here for every day a customer trades.
            </p>
          ) : (
            <>
              <div className="mt-5 flex h-36 items-end gap-[3px]">
                {acct.daily.map((d) => (
                  /* h-full so the bar's percentage has a height to resolve
                     against: in an items-end row the column is otherwise only
                     as tall as its content, which is the bar itself. */
                  <div key={d.day} className="group flex h-full flex-1 items-end"
                    title={`${dayLabel(d.day)} · ${TZS(d.earned)} · ${d.trades} ${d.trades === 1 ? "trade" : "trades"}`}>
                    <div
                      className="w-full rounded-t-[3px] bg-[var(--color-accent)] transition-opacity group-hover:opacity-70"
                      style={{ height: `${Math.max(3, (d.earned / peak) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-[var(--muted)]">
                <span>{dayLabel(acct.daily[0].day)}</span>
                <span className="tnum">peak {short(peak)}</span>
                <span>{dayLabel(acct.daily[acct.daily.length - 1].day)}</span>
              </div>
            </>
          )}
        </div>

        {/* Where the volume is. */}
        <div className="rounded-3xl border hairline p-5">
          <div className="eyebrow">By security</div>
          <div className="mt-1 text-[12px] text-[var(--muted)]">All time</div>
          {acct.bySecurity.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--muted)]">No trades yet.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {acct.bySecurity.slice(0, 6).map((s) => {
                const share = topSecurity ? (s.earned / topSecurity.earned) * 100 : 0;
                return (
                  <div key={s.security}>
                    <div className="flex items-center gap-2.5">
                      <DseLogo logo={dseLogoOf(dse, s.security)} symbol={s.security} size={26} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.security}</span>
                      <span className="tnum shrink-0 text-[12px]">{TZS(s.earned)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full surface">
                      <div className="h-full rounded-full bg-[var(--fg)]"
                        style={{ width: `${Math.max(4, share)}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--muted)]">
                      {s.trades} {s.trades === 1 ? "trade" : "trades"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* The account itself. */}
      <div id="earnings" className="mt-4 scroll-mt-24 rounded-3xl border hairline p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="eyebrow">Your account</div>
            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-[var(--muted)]">
              Every trade credits your share here. The shillings sit in the CAPX settlement
              account until a payout is made, exactly as customers&rsquo; do — this is the record
              of what is owed, and both desks read the same rows.
            </p>
          </div>
          <div className="text-right">
            <div className="eyebrow">Balance</div>
            <div className="tnum text-2xl font-medium">{TZS(acct.balance)}</div>
          </div>
        </div>

        {isAdmin && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl surface p-3">
            <span className="eyebrow mr-1">Record a payout</span>
            <input
              value={payout} onChange={(e) => setPayout(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Amount in TZS"
              className="w-40 rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <input
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Reference — bank transfer, date"
              className="min-w-0 flex-1 rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button onClick={() => void pay()} disabled={busy || !(Number(payout) > 0)}
              className="rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40">
              {busy ? "Recording…" : "Record"}
            </button>
            {msg && <span className="w-full text-[12px] text-[var(--muted)]">{msg}</span>}
          </div>
        )}

        {acct.entries.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-2xl border hairline">
            {acct.entries.slice(0, 12).map((e) => (
              <div key={e.id} className="flex items-center gap-3 border-b hairline px-3.5 py-2.5 last:border-0">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] ${
                  e.kind === "payout" ? "bg-[var(--color-down)]/10 text-[var(--color-down)]"
                                      : "bg-[var(--color-up)]/10 text-[var(--color-up)]"}`}>
                  {e.kind === "payout" ? "↑" : "↓"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-tight">
                    {e.kind === "payout" ? "Paid out" : `Fee · ${e.security ?? "—"}`}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--muted)]">
                    {new Date(e.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    {e.note ? ` · ${e.note}` : ""}
                  </span>
                </span>
                <span className={`tnum shrink-0 text-[13px] ${
                  e.amountTzs < 0 ? "text-[var(--color-down)]" : ""}`}>
                  {e.amountTzs < 0 ? "−" : "+"}{TZS(Math.abs(e.amountTzs))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, note, tone }: {
  label: string; value: string; note?: string; tone?: "up";
}) {
  return (
    <div className="bg-[var(--bg)] px-4 py-4 sm:px-5">
      <div className="eyebrow truncate">{label}</div>
      <div className={`tnum mt-1.5 text-xl font-medium sm:text-2xl ${tone === "up" ? "text-[var(--color-up)]" : ""}`}>
        {value}
      </div>
      {note && <div className="mt-1 truncate text-[11px] text-[var(--muted)]">{note}</div>}
    </div>
  );
}
