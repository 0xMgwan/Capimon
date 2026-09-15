"use client";

import { useCallback, useEffect, useState } from "react";

type Backing = {
  security: string; custodian: string | null;
  underlying: number; locked: number; issued: number;
  recorded: number; drift: number; source: "chain" | "ledger";
  custodySource: "chain" | "filed" | "none"; custodyMismatch: string | null;
  ratioPct: number | null; headroom: number;
  fresh: boolean; expiresAt: string | null; lastVerified: string | null;
};
type Security = { symbol: string; name: string; token_address: string | null; status: string; backing: Backing };
type Attestation = {
  id: string; security: string; custodian: string; quantity: number; locked: number;
  doc_ref: string | null; issued_at: string; expires_at: string;
  status: string; approved_by: string | null; expired: boolean;
};
type Issuance = { id: string; security: string; kind: string; quantity: number; tx_hash: string | null; created_at: string };

const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * The custody desk: what a custodian says it holds, and what may be issued
 * against it.
 *
 * Deliberately not a form that mints. Filing an attestation, approving it and
 * issuing against it are three steps, because approval is the moment CAPX
 * asserts the shares are really in the vault — and that should be a decision
 * somebody makes, not a side effect of typing numbers into a box.
 */
export function SecuritiesDesk() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<{ securities: Security[]; attestations: Attestation[]; issuance: Issuance[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (t: string) => {
    if (!t) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/custody?token=${encodeURIComponent(t)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.code === "unauthorised" ? "That token was not accepted." : j.error);
      setData({ securities: j.securities ?? [], attestations: j.attestations ?? [], issuance: j.issuance ?? [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load");
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!data || !token) return;
    const id = setInterval(() => void load(token), 30_000);
    return () => clearInterval(id);
  }, [data, token, load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/admin/custody", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      // A refused mint is the backing rule working, so it reads as a result
      // rather than a failure.
      if (!j.ok) throw new Error(j.error ?? "Action failed");
      setNote("Done.");
      await load(token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
        <div className="eyebrow">Operations</div>
        <h1 className="display mt-3 text-3xl">Securities desk.</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">Custody, issuance and the price feed.</p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(token); }}
          type="password" placeholder="Admin token"
          className="mt-6 w-full rounded-xl border hairline bg-transparent px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          onClick={() => void load(token)} disabled={busy || !token}
          className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
        >
          {busy ? "Checking…" : "Open desk"}
        </button>
        {err && <p className="mt-3 text-xs text-[var(--color-down)]">{err}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 pt-6 sm:px-8 sm:pt-12">
      <div className="eyebrow">Operations</div>
      <h1 className="display mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">Securities desk.</h1>

      {(note || err) && (
        <p className={`mt-4 break-words rounded-2xl border hairline px-4 py-3 text-xs ${
          err ? "text-[var(--color-down)]" : "text-[var(--muted)]"}`}>
          {err ?? note}
        </p>
      )}

      {/* Backing first: it is the number every other panel exists to justify. */}
      <section className="mt-8 grid gap-4">
        {data.securities.length === 0 && (
          <p className="rounded-3xl border hairline p-6 text-sm text-[var(--muted)]">
            No securities registered yet. Register one below to begin.
          </p>
        )}
        {data.securities.map((s) => {
          const b = s.backing;
          const under = b.ratioPct !== null && b.ratioPct < 100;
          return (
            <div key={s.symbol} className={`rounded-3xl border p-5 ${
              under ? "border-[var(--color-down)]/50 bg-[var(--color-down)]/[0.05]" : "hairline"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <span className="text-xl font-medium">{s.symbol}</span>
                  <span className="ml-2 text-sm text-[var(--muted)]">{s.name}</span>
                </div>
                <div className={`tnum text-2xl font-medium ${under ? "text-[var(--color-down)]" : "text-[var(--color-up)]"}`}>
                  {b.ratioPct === null ? "—" : `${b.ratioPct.toFixed(2)}%`}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-5">
                <Cell label="Underlying" value={b.underlying.toLocaleString()} />
                <Cell label="Locked" value={b.locked.toLocaleString()} />
                <Cell
                  label={b.source === "chain" ? "Issued (chain)" : "Issued (log)"}
                  value={b.issued.toLocaleString()}
                />
                <Cell label="Headroom" value={b.headroom.toLocaleString()} />
                <Cell label="Custodian" value={b.custodian ?? "—"} />
              </div>
              <p className="mt-3 text-[11px] text-[var(--muted)]">
                {b.fresh
                  ? `${b.custodySource === "chain" ? "On-chain attestation" : "Filed attestation (not yet published on-chain)"} in force until ${dt(b.expiresAt)}. Verified ${dt(b.lastVerified)}.`
                  : "No attestation in force — issuance is blocked until one is approved."}
              </p>

              {/*
                * The log and the chain disagreeing is the one thing on this page
                * that cannot be left to a number nobody reads. Minting happens
                * with the issuer key, outside this app, so a gap here means a
                * mint was recorded and never executed, or executed and never
                * recorded — and both need a person, not a refresh.
                */}
              {b.custodyMismatch && (
                <p className="mt-2 rounded-xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/[0.06] px-3 py-2 text-[11px] text-[var(--color-down)]">
                  {b.custodyMismatch} The smaller figure is in force until they agree.
                </p>
              )}

              {b.drift !== 0 && (
                <p className="mt-2 rounded-xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/[0.06] px-3 py-2 text-[11px] text-[var(--color-down)]">
                  {b.drift > 0
                    ? `${b.drift.toLocaleString()} more on-chain than the issuance log records — a mint happened that was never written down.`
                    : `${Math.abs(b.drift).toLocaleString()} recorded in the issuance log but not on-chain — a mint was logged and never executed.`}
                  {" "}Issuance is measured against the larger of the two until this is resolved.
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <MintBurn security={s.symbol} headroom={b.headroom} issued={b.issued} onAct={act} busy={busy} />
              </div>
            </div>
          );
        })}
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <RegisterSecurity onAct={act} busy={busy} />
        <FileAttestation onAct={act} busy={busy} />
      </div>

      <OracleAdmin token={token} busy={busy} setBusy={setBusy} setErr={setErr} setNote={setNote} />

      <section className="mt-8">
        <div className="eyebrow mb-2">Attestations</div>
        <div className="overflow-hidden rounded-2xl border hairline">
          {data.attestations.length === 0 ? (
            <p className="p-5 text-center text-sm text-[var(--muted)]">Nothing filed yet.</p>
          ) : data.attestations.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-3 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {a.security} · {a.quantity.toLocaleString()} held, {a.locked.toLocaleString()} locked
                </span>
                <span className="block text-[11px] text-[var(--muted)]">
                  {a.custodian || "—"} · {a.doc_ref || "no reference"} · expires {dt(a.expires_at)}
                  {a.expired && " · EXPIRED"}
                </span>
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                a.status === "approved" && !a.expired ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
                : a.status === "rejected" ? "bg-[var(--color-down)]/10 text-[var(--color-down)]"
                : "surface text-[var(--muted)]"}`}>
                {a.expired && a.status === "approved" ? "expired" : a.status}
              </span>
              {a.status === "pending" && (
                <span className="flex gap-2">
                  <button onClick={() => void act({ action: "approve-attestation", id: a.id })} disabled={busy}
                    className="rounded-full border hairline px-3 py-1.5 text-[12px] hover:surface disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => void act({ action: "reject-attestation", id: a.id })} disabled={busy}
                    className="rounded-full border hairline px-3 py-1.5 text-[12px] text-[var(--color-down)] hover:surface disabled:opacity-50">
                    Reject
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="eyebrow mb-2">Issuance log</div>
        <div className="overflow-hidden rounded-2xl border hairline">
          {data.issuance.length === 0 ? (
            <p className="p-5 text-center text-sm text-[var(--muted)]">No mints or burns yet.</p>
          ) : data.issuance.map((i) => (
            <div key={i.id} className="flex items-center gap-3 border-b hairline px-4 py-2.5 last:border-0">
              <span className={`tnum w-16 text-sm font-medium ${
                i.kind === "mint" ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {i.kind === "mint" ? "+" : "−"}{i.quantity.toLocaleString()}
              </span>
              <span className="flex-1 text-sm">{i.security}</span>
              <span className="text-[11px] text-[var(--muted)]">{dt(i.created_at)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Issue or retire tokens, bounded by what custody allows. */
function MintBurn({ security, headroom, issued, onAct, busy }: {
  security: string; headroom: number; issued: number;
  onAct: (b: Record<string, unknown>) => Promise<void>; busy: boolean;
}) {
  const [qty, setQty] = useState("");
  const n = Number(qty) || 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
        inputMode="decimal" placeholder="Quantity"
        className="tnum w-28 rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <button
        onClick={() => void onAct({ action: "mint", security, quantity: n })}
        disabled={busy || !(n > 0) || n > headroom}
        title={n > headroom ? `Only ${headroom} may be issued against current custody` : undefined}
        className="rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
      >
        Mint
      </button>
      <button
        onClick={() => void onAct({ action: "burn", security, quantity: n })}
        disabled={busy || !(n > 0) || n > issued}
        className="rounded-full border hairline px-4 py-2 text-[13px] font-medium hover:surface disabled:opacity-40"
      >
        Burn
      </button>
      <span className="text-[11px] text-[var(--muted)]">max mint {headroom.toLocaleString()}</span>
    </div>
  );
}

function RegisterSecurity({ onAct, busy }: { onAct: (b: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [f, setF] = useState({ symbol: "", name: "", tokenAddress: "", decimals: "8" });
  return (
    <div className="rounded-3xl border hairline p-5">
      <div className="eyebrow">Register a security</div>
      {/*
        * The symbol is a key, not a label.
        *
        * It is what custody and the oracle are looked up by, so it has to match
        * the string those were written under — CRDB, the security, rather than
        * CRDBt, the token that represents it. Getting it wrong does not error:
        * the desk simply reports no attestation in force while one sits on the
        * registry, and issuance stays blocked with nothing to point at.
        */}
      <Field label="Symbol" v={f.symbol} on={(v) => setF({ ...f, symbol: v.toUpperCase() })} ph="CRDB"
        hint="The security's key in the custody registry and oracle — CRDB, not CRDBt." />
      <Field label="Name" v={f.name} on={(v) => setF({ ...f, name: v })} ph="CRDB Bank Plc" />
      <Field label="Token address" v={f.tokenAddress} on={(v) => setF({ ...f, tokenAddress: v })} ph="0xb200…60F"
        hint="Checked against the token on Base before it is saved." />
      <Field label="Decimals" v={f.decimals} on={(v) => setF({ ...f, decimals: v })} ph="8"
        hint="Read from the token itself when an address is given." />
      <button
        onClick={() => void onAct({ action: "register-security", ...f, decimals: Number(f.decimals) })}
        disabled={busy || !f.symbol || !f.name}
        className="mt-2 w-full rounded-full bg-[var(--fg)] py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
}

function FileAttestation({ onAct, busy }: { onAct: (b: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  /*
   * The custodian is blank on purpose.
   *
   * A prefilled bank name is one click away from asserting that an institution
   * confirmed a holding it has never been asked about, and an attestation is
   * exactly the record that must not be filled in for you.
   */
  const [f, setF] = useState({ security: "", custodian: "", quantity: "", locked: "", docRef: "", expiresAt: "" });
  const q = Number(f.quantity) || 0;
  const l = Number(f.locked || f.quantity) || 0;
  return (
    <div className="rounded-3xl border hairline p-5">
      <div className="eyebrow">File a custody attestation</div>
      <Field label="Security" v={f.security} on={(v) => setF({ ...f, security: v.toUpperCase() })} ph="CRDB"
        hint="The registered security's symbol — CRDB, not CRDBt." />
      <Field label="Custodian" v={f.custodian} on={(v) => setF({ ...f, custodian: v })}
        ph="Who is confirming the holding"
        hint="Name the party actually standing behind this. If none has confirmed yet, say so here." />
      <Field label="Shares held" v={f.quantity} on={(v) => setF({ ...f, quantity: v.replace(/[^0-9.]/g, "") })} ph="100" />
      <Field label="Of those, locked" v={f.locked} on={(v) => setF({ ...f, locked: v.replace(/[^0-9.]/g, "") })} ph="100" />
      <Field label="Custodian reference" v={f.docRef} on={(v) => setF({ ...f, docRef: v })}
        ph="Statement or reference number" />
      <label className="mb-3 block">
        <span className="eyebrow">Expires</span>
        <input
          type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })}
          className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </label>
      {l > q && q > 0 && (
        <p className="mb-2 text-[11px] text-[var(--color-down)]">Locked cannot exceed the shares held.</p>
      )}
      <button
        onClick={() => void onAct({
          action: "attest", ...f, quantity: q, locked: l,
          expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T23:59:59Z`).toISOString() : "",
        })}
        disabled={busy || !f.security || !f.custodian.trim() || !(q > 0) || l > q || !f.expiresAt}
        className="mt-1 w-full rounded-full bg-[var(--fg)] py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
      >
        File for approval
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
        Filing does not issue anything. It has to be approved first, and approval is
        the moment CAPX asserts these shares are really in the vault.
      </p>
    </div>
  );
}

/**
 * The reference price, with its source on the record.
 *
 * Prices are entered in whole shillings and converted to nTZS's eighteen
 * decimals on the way out, because that is the unit settlement works in and
 * expecting an operator to type 2500000000000000000000 invites the kind of
 * mistake that prices a trade a thousand times wrong.
 */
function OracleAdmin({ token, busy, setBusy, setErr, setNote }: {
  token: string; busy: boolean;
  setBusy: (b: boolean) => void;
  setErr: (s: string | null) => void;
  setNote: (s: string | null) => void;
}) {
  const [f, setF] = useState({ symbol: "CRDB", price: "", source: "DSE reference (manual)" });
  const [quotes, setQuotes] = useState<{ symbol: string; price: number; source: string; updatedAt: string; fresh: boolean }[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/oracle", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setQuotes(j.quotes ?? []);
    } catch { /* the desk still works without the list */ }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void load(); };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearTimeout(first); clearInterval(id); };
  }, [load]);

  const save = async () => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/oracle", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol: f.symbol, priceTzs: Number(f.price), source: f.source }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not set the price");
      setNote(`${f.symbol} marked at ${Number(f.price).toLocaleString()} TZS.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not set the price");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 rounded-3xl border hairline p-5">
      <div className="eyebrow">Price feed</div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-[7rem] flex-1">
          <span className="eyebrow">Symbol</span>
          <input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })}
            className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]" />
        </label>
        <label className="min-w-[9rem] flex-1">
          <span className="eyebrow">Price (whole TZS)</span>
          <input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, "") })}
            inputMode="decimal" placeholder="2500"
            className="tnum mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]" />
        </label>
        <label className="min-w-[12rem] flex-[2]">
          <span className="eyebrow">Source</span>
          <input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}
            className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]" />
        </label>
        <button onClick={() => void save()} disabled={busy || !f.symbol || !(Number(f.price) > 0)}
          className="rounded-full bg-[var(--fg)] px-5 py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40">
          Set price
        </button>
      </div>

      {quotes.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border hairline">
          {quotes.map((q) => (
            <div key={q.symbol} className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-2.5 last:border-0">
              <span className="w-16 text-sm font-medium">{q.symbol}</span>
              <span className="tnum flex-1 text-sm">{q.price.toLocaleString()} TZS</span>
              <span className="text-[11px] text-[var(--muted)]">{q.source}</span>
              <span className="text-[11px] text-[var(--muted)]">{dt(q.updatedAt)}</span>
              {/* A stale mark must be visible: settlement refuses to price
                  against it, and the desk should say so before someone tries. */}
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                q.fresh ? "bg-[var(--color-up)]/10 text-[var(--color-up)]" : "bg-[var(--color-down)]/10 text-[var(--color-down)]"}`}>
                {q.fresh ? "live" : "stale"}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        Entered in whole shillings and stored with its source and timestamp. Settlement
        refuses to price a trade against a mark that has gone stale.
      </p>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg)] px-3 py-2.5">
      <div className="eyebrow leading-tight">{label}</div>
      <div className="tnum mt-1 truncate text-[15px] font-medium">{value}</div>
    </div>
  );
}

function Field({ label, v, on, ph, hint }: {
  label: string; v: string; on: (v: string) => void; ph?: string; hint?: string;
}) {
  return (
    <label className="mb-3 block">
      <span className="eyebrow">{label}</span>
      <input value={v} onChange={(e) => on(e.target.value)} placeholder={ph}
        className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]" />
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}
