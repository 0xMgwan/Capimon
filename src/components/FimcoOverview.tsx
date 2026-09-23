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

type Payout = {
  method: "mobile" | "bank";
  phoneNumber?: string; bankCode?: string; accountNumber?: string; accountName?: string;
};

type Account = {
  balance: number;
  /** The part of the balance that has been swept and can be taken now. */
  available: number;
  payout: Payout | null;
  /** The nTZS account their fees are swept into, and why it is as it is. */
  wallet?: {
    address: string | null; tzs: number;
    configured?: boolean; externalId?: string | null;
    hasNida?: boolean; hasPhone?: boolean; pinnedUserId?: boolean;
  } | null;
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

  /*
   * "send" moves the money; "record" only writes down a transfer that was
   * made by hand. Both exist because both happen, and the ledger has to match
   * the bank either way.
   */
  const pay = async (action: "send" | "record") => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/broker", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, amountTzs: Number(payout), note: note || null }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not complete the payout");
      setMsg(j.sent
        ? `Sent. ${TZS(j.balance)} still owed. Reference ${j.reference}.`
        : `Recorded. ${TZS(j.balance)} still owed.`);
      setPayout(""); setNote(""); setReload((n) => n + 1);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not complete the payout");
    } finally {
      setBusy(false);
    }
  };

  const openAccount = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/broker", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "open-account" }),
      });
      const j = await r.json();
      /*
       * Every step, not only the failures.
       *
       * "attestation refused" on its own reads as a dead end. "identity
       * attached, then attestation refused, account now pending_review" is
       * the same facts and a different conclusion — the account is waiting on
       * somebody at nTZS rather than on us.
       */
      const steps = (j.steps ?? []) as { step: string; ok: boolean; detail: string }[];
      setMsg(j.ok
        ? `Wallet issued: ${j.wallet}.`
        : [
            ...steps.map((s) => `${s.ok ? "✓" : "✕"} ${s.step}: ${s.detail}`),
            j.kycStatus ? `Account is now “${j.kycStatus}”.` : null,
          ].filter(Boolean).join("\n") || j.error || "Could not open the wallet.");
      setReload((n) => n + 1);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not open the wallet");
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

  /* Every day in the window, quiet ones included — the server fills the
     calendar, because it is the one that knows what day it is. */
  const series = acct.daily;

  const earned30 = acct.daily.reduce((s, d) => s + d.earned, 0);
  const trades30 = acct.daily.reduce((s, d) => s + d.trades, 0);
  const paid = acct.entries.filter((e) => e.kind === "payout").reduce((s, e) => s + Math.abs(e.amountTzs), 0);
  const peak = Math.max(1, ...series.map((d) => d.earned));
  const topSecurity = acct.bySecurity[0];
  /* Each security's bar is its share of everything earned, so two equal
     earners read as half each rather than as full bars apiece. */
  const totalBySecurity = acct.bySecurity.reduce((sum, x) => sum + x.earned, 0);

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

          {earned30 === 0 ? (
            <p className="mt-8 text-center text-sm text-[var(--muted)]">
              Nothing yet. A bar appears here for every day a customer trades.
            </p>
          ) : (
            <>
              <div className="mt-5 flex h-36 items-end gap-[3px]">
                {series.map((d) => (
                  /* h-full so the bar's percentage has a height to resolve
                     against: in an items-end row the column is otherwise only
                     as tall as its content, which is the bar itself. */
                  <div key={d.day} className="group flex h-full flex-1 items-end"
                    title={`${dayLabel(d.day)} · ${TZS(d.earned)} · ${d.trades} ${d.trades === 1 ? "trade" : "trades"}`}>
                    {/* A day with nothing is a faint floor, not a bar: an
                        empty day and a tiny one should not look alike. */}
                    <div
                      className={`w-full rounded-t-[3px] transition-opacity group-hover:opacity-70 ${
                        d.earned > 0 ? "bg-[var(--color-accent)]" : "bg-[var(--border)]"
                      }`}
                      style={{ height: d.earned > 0 ? `${Math.max(6, (d.earned / peak) * 100)}%` : "2px" }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-[var(--muted)]">
                <span>{dayLabel(series[0].day)}</span>
                <span className="tnum">peak {short(peak)}</span>
                <span>{dayLabel(series[series.length - 1].day)}</span>
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
                const share = totalBySecurity > 0 ? (s.earned / totalBySecurity) * 100 : 0;
                return (
                  <div key={s.security}>
                    <div className="flex items-center gap-2.5">
                      <DseLogo logo={dseLogoOf(dse, s.security)} symbol={s.security} size={26} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.security}</span>
                      <span className="tnum shrink-0 text-[12px]">{TZS(s.earned)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full surface">
                      <div className="h-full rounded-full bg-[var(--fg)]"
                        style={{ width: `${Math.min(100, Math.max(4, share))}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--muted)]">
                      {s.trades} {s.trades === 1 ? "trade" : "trades"} · {share.toFixed(0)}%
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
              Every trade credits your share here. The shillings are moved into an nTZS
              account that holds nothing but your fees, and a withdrawal is paid from it —
              this is the record of what is owed, and both desks read the same rows.
            </p>
          </div>
          <div className="text-right">
            <div className="eyebrow">Balance</div>
            <div className="tnum text-2xl font-medium">{TZS(acct.balance)}</div>
            {/* Two true figures that are not the same: what is owed, and the
                part of it that has been moved into the fee account and can
                therefore be taken without touching customer float. */}
            {acct.available < acct.balance && (
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                {TZS(acct.available)} available now
              </div>
            )}
          </div>
        </div>

        {/*
          * The account their fees actually sit in.
          *
          * nTZS holds the wallet until the account clears KYC, and an account
          * with no wallet cannot be swept into — so when that is the state,
          * the desk says so and offers the one action that fixes it rather
          * than failing quietly at the next sweep.
          */}
        {isAdmin && !acct.wallet?.address && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-[#b45309]/40 bg-[#b45309]/[0.06] p-3">
            <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--muted)]">
              {acct.wallet?.configured === false ? (
                <>
                  No fee account is configured, so the broker&rsquo;s share stays in the settlement
                  account. It needs an identity of its own:{" "}
                  {acct.wallet?.hasNida ? "" : "NTZS_BROKER_NIDA, "}
                  {acct.wallet?.hasPhone ? "" : "NTZS_BROKER_PHONE, "}
                  and nothing else.
                </>
              ) : (
                <>
                  The fee account{acct.wallet?.externalId ? ` (${acct.wallet.externalId})` : ""} has
                  no nTZS wallet yet, so fees cannot be swept into it and withdrawals are paid from
                  the settlement account.
                </>
              )}
            </span>
            <button onClick={() => void openAccount()} disabled={busy}
              className="shrink-0 rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40">
              {busy ? "Opening…" : "Open the wallet"}
            </button>
          </div>
        )}
        {isAdmin && acct.wallet?.address && (
          <p className="tnum mt-3 text-[11px] text-[var(--muted)]">
            Fee account {acct.wallet.address.slice(0, 10)}…{acct.wallet.address.slice(-6)} ·
            holding {TZS(acct.wallet.tzs)}
          </p>
        )}

        {/* Where the money goes, named by the party it belongs to. */}
        <PayoutAccount token={token} isAdmin={isAdmin} saved={acct.payout}
          onSaved={() => setReload((n) => n + 1)} />

        {/*
          * Both sides can send; only CAPX can write down a transfer made
          * elsewhere. Taking your own earnings over a rail that refuses when
          * the money is not there is a different act from asserting that
          * money already left somebody else's bank account.
          */}
        <div className="mt-3 rounded-2xl surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow mr-1">{isAdmin ? "Pay out" : "Withdraw"}</span>
              <input
                value={payout} onChange={(e) => setPayout(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Amount in TZS"
                className="w-40 rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <input
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Note — optional"
                className="min-w-0 flex-1 rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <button onClick={() => void pay("send")}
                disabled={busy || !(Number(payout) > 0) || !acct.payout || Number(payout) > acct.available}
                title={acct.payout ? undefined : "No payout account saved yet"}
                className="rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40">
                {busy ? "Sending…" : isAdmin ? "Send now" : "Withdraw"}
              </button>
              {isAdmin && (
                <button onClick={() => void pay("record")} disabled={busy || !(Number(payout) > 0)}
                  className="rounded-full border hairline px-4 py-2 text-[13px] hover:bg-[var(--bg)] disabled:opacity-40">
                  Record only
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
              {isAdmin ? (
                <>
                  <span className="text-[var(--fg)]">Send now</span> pays the account below from the
                  settlement account, over the same rail a customer withdrawal uses.{" "}
                  <span className="text-[var(--fg)]">Record only</span> writes down a transfer CAPX
                  already made by hand — a bank transfer sent outside the app — so the ledger still
                  matches the bank.
                </>
              ) : (
                <>Paid to the account below, over the same rail a customer withdrawal uses.
                  {acct.available < acct.balance
                    ? <> You can take {TZS(acct.available)} now; the rest is earned but has not been
                        moved into the fee account yet.</>
                    : <> You can take up to what is owed; nothing else touches this balance.</>}</>
              )}
            </p>
            {msg && (
              <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-[var(--muted)]">{msg}</p>
            )}
          </div>

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

/**
 * The account a payout lands in — the broker's to name, not CAPX's to type.
 *
 * An operations team copying a counterparty's account number out of a message
 * is how money reaches the wrong account. CAPX can see it, so a payment can
 * be checked before it is sent, and cannot change it.
 */
function PayoutAccount({ token, isAdmin, saved, onSaved }: {
  token: string; isAdmin: boolean; saved: Payout | null; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([]);
  /* When the list is the fallback rather than nTZS's own, say so: three banks
     where there should be thirty-eight is a fact an operator can act on. */
  const [bankNote, setBankNote] = useState<string | null>(null);
  const [otherBank, setOtherBank] = useState(false);
  const [form, setForm] = useState<Payout>(saved ?? { method: "mobile", phoneNumber: "" });

  useEffect(() => {
    if (form.method !== "bank" || banks.length) return;
    let alive = true;
    fetch("/api/ntzs/banks", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j.ok) return;
        setBanks(j.banks ?? []);
        setBankNote(j.source === "ntzs" ? null
          : `Showing ${(j.banks ?? []).length} fallback banks — nTZS's list could not be read.`
            + (j.tried?.length ? ` ${j.tried.map((t: { path: string; outcome: string }) => `${t.path}: ${t.outcome}`).join(" · ")}` : "")
            + (j.sample ? ` · a catalogue entry looks like: ${Object.keys(j.sample).join(", ")}` : ""));
      })
      .catch(() => { /* the field still accepts a code */ });
    return () => { alive = false; };
  }, [form.method, banks.length, token]);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/contacts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ payout: form }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not save");
      setEditing(false); onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const describe = (p: Payout) =>
    p.method === "bank"
      ? `${p.bankCode} · ${p.accountNumber}${p.accountName ? ` · ${p.accountName}` : ""}`
      : `${p.phoneNumber}${p.accountName ? ` · ${p.accountName}` : ""}`;

  return (
    <div className="mt-4 rounded-2xl border hairline p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow">Paid to</div>
          <p className="mt-0.5 truncate text-[13px]">
            {saved ? describe(saved) : <span className="text-[var(--muted)]">No account saved yet</span>}
          </p>
        </div>
        {isAdmin ? (
          <span className="text-[11px] text-[var(--muted)]">FIMCO sets this</span>
        ) : (
          <button onClick={() => { setForm(saved ?? { method: "mobile", phoneNumber: "" }); setEditing((v) => !v); }}
            className="rounded-full border hairline px-3 py-1.5 text-[12px] hover:surface">
            {editing ? "Cancel" : saved ? "Change" : "Add an account"}
          </button>
        )}
      </div>

      {editing && !isAdmin && (
        <div className="mt-3 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            {(["mobile", "bank"] as const).map((m) => (
              <button key={m}
                onClick={() => setForm({ ...form, method: m })}
                className={`rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors ${
                  form.method === m ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                }`}>
                {m === "mobile" ? "Mobile money" : "Bank account"}
              </button>
            ))}
          </div>

          {form.method === "mobile" ? (
            <input
              value={form.phoneNumber ?? ""}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value.replace(/[^0-9]/g, "") })}
              placeholder="255712345678"
              className="rounded-xl border hairline bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          ) : (
            <>
              {/*
                * A picker, and a way past it.
                *
                * nTZS reaches thirty-eight banks but publishes no list we can
                * read, so the picker is three fallback names — and a broker
                * whose bank is not among them had no way to be paid at all.
                * The code can be typed instead, and it is not taken on trust:
                * a payout is quoted before it is sent, and an unknown code
                * fails the quote with nothing moved.
                */}
              <select
                value={otherBank ? "__other" : form.bankCode ?? ""}
                onChange={(e) => {
                  if (e.target.value === "__other") { setOtherBank(true); setForm({ ...form, bankCode: "" }); }
                  else { setOtherBank(false); setForm({ ...form, bankCode: e.target.value }); }
                }}
                className="rounded-xl border hairline bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">Choose a bank</option>
                {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                <option value="__other">Another bank — enter its code</option>
              </select>
              {otherBank && (
                <>
                  <input
                    value={form.bankCode ?? ""}
                    onChange={(e) => setForm({ ...form, bankCode: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })}
                    placeholder="Bank code, e.g. NBC"
                    className="rounded-xl border hairline bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                  <p className="text-[11px] text-[var(--muted)]">
                    The canonical FI code nTZS uses. It is checked when a payout is priced, before
                    any money moves — a wrong code fails there rather than paying the wrong account.
                  </p>
                </>
              )}
              {bankNote && <p className="text-[11px] text-[#b45309]">{bankNote}</p>}
              <input
                value={form.accountNumber ?? ""}
                onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="Account number"
                className="rounded-xl border hairline bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </>
          )}

          <input
            value={form.accountName ?? ""}
            onChange={(e) => setForm({ ...form, accountName: e.target.value })}
            placeholder="Account name, so a payment can be checked"
            className="rounded-xl border hairline bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />

          {err && <p className="text-[12px] text-[var(--color-down)]">{err}</p>}
          <button onClick={() => void save()} disabled={busy}
            className="rounded-full bg-[var(--fg)] px-4 py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40">
            {busy ? "Saving…" : "Save account"}
          </button>
        </div>
      )}
    </div>
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
