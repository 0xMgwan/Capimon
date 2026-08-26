"use client";

import { useCallback, useEffect, useState } from "react";
import { usd } from "@/lib/format";

type Admin = {
  totals: { users: number; pendingDeposits: number; settledTzs: number; creditedUsdc: number };
  solvency: { ok: boolean; totals: { owedUsd: number; heldUsd: number; shortfallUsd: number };
              assets: { asset: string; owed: number; held: number; covered: boolean }[];
              unavailable?: string } | null;
  omnibus: { tzs: number; usdc: number } | null;
  treasury: string | null;
  deposits: { id: string; email: string; amount_tzs: number; status: string; usdc_credited: string | null;
              phone: string; error: string | null; created_at: string }[];
  users: { id: string; email: string; name: string | null; phone: string | null; deposits: number; created_at: string }[];
  orders: { id: string; email: string; side: string; symbol: string; usdc_amount: string | null;
            qty: string | null; status: string; tx_hash: string | null; created_at: string }[];
};

const TZS = (n: number) => `${Math.round(n).toLocaleString()} TZS`;

/**
 * Operations view. The token is held in the tab only — never persisted, so a
 * shared machine does not leave a door open to every customer's deposits.
 */
export function AdminPanel() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Admin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"deposits" | "users" | "orders">("deposits");

  const load = useCallback(async (t: string) => {
    if (!t) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin", { headers: { authorization: `Bearer ${t}` }, cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.code === "unauthorised" ? "That token was not accepted." : j.error);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!data || !token) return;
    const id = setInterval(() => void load(token), 20_000);
    return () => clearInterval(id);
  }, [data, token, load]);

  const settle = async () => {
    setBusy(true);
    await fetch("/api/ntzs/settle", { method: "POST" }).catch(() => {});
    await load(token);
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-24">
        <div className="eyebrow">Operations</div>
        <h1 className="display mt-3 text-3xl">Restricted.</h1>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(token); }}
          type="password" placeholder="Admin token"
          className="mt-6 w-full rounded-xl border hairline bg-transparent px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          onClick={() => load(token)}
          disabled={busy || !token}
          className="mt-3 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
        >
          {busy ? "Checking…" : "Open"}
        </button>
        {error && <p className="mt-3 text-xs text-[var(--color-down)]">{error}</p>}
      </div>
    );
  }

  const s = data.solvency;
  const tabs = [
    ["deposits", `Deposits (${data.deposits.length})`],
    ["users", `Users (${data.totals.users})`],
    ["orders", `Orders (${data.orders.length})`],
  ] as const;

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Operations</div>
          <h1 className="display mt-2 text-[clamp(1.8rem,4vw,2.8rem)]">Custody desk.</h1>
        </div>
        <button onClick={settle} disabled={busy}
          className="rounded-full border hairline px-5 py-2.5 text-sm transition-colors hover:surface disabled:opacity-50">
          {busy ? "Working…" : "Settle pending deposits"}
        </button>
      </div>

      {/* Solvency leads — it is the number that decides whether anything else matters. */}
      <div className={`mt-8 rounded-3xl border p-6 ${
        !s || s.unavailable ? "hairline"
          : s.ok ? "border-[var(--color-up)]/40 bg-[var(--color-up)]/[0.05]"
                 : "border-[var(--color-down)]/50 bg-[var(--color-down)]/[0.07]"}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="text-sm font-medium">
            {!s || s.unavailable ? "Solvency unavailable"
              : s.ok ? "Client assets are fully backed" : "SHORTFALL — trading is paused"}
          </div>
          {s?.unavailable && <span className="text-xs text-[var(--muted)]">{s.unavailable}</span>}
        </div>
        {s && !s.unavailable && (
          <>
            <div className="tnum mt-4 grid grid-cols-3 gap-4 text-sm">
              <div><div className="eyebrow">Owed to clients</div><div className="mt-1">{usd(s.totals.owedUsd)}</div></div>
              <div><div className="eyebrow">Held in treasury</div><div className="mt-1">{usd(s.totals.heldUsd)}</div></div>
              <div><div className="eyebrow">Shortfall</div>
                <div className={`mt-1 ${s.totals.shortfallUsd > 0 ? "text-[var(--color-down)]" : ""}`}>
                  {usd(s.totals.shortfallUsd)}
                </div></div>
            </div>
            {s.assets.length > 0 && (
              <div className="tnum mt-4 flex flex-wrap gap-2 text-[11px]">
                {s.assets.map((a) => (
                  <span key={a.asset} className={`rounded-full px-2.5 py-1 ${
                    a.covered ? "surface text-[var(--muted)]" : "bg-[var(--color-down)]/15 text-[var(--color-down)]"}`}>
                    {a.asset} {a.held.toFixed(4)}/{a.owed.toFixed(4)}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-4">
        <Cell label="Users" value={String(data.totals.users)} />
        <Cell label="Pending deposits" value={String(data.totals.pendingDeposits)} />
        <Cell label="Collected" value={TZS(data.totals.settledTzs)} />
        <Cell label="Omnibus nTZS" value={data.omnibus ? TZS(data.omnibus.tzs) : "—"} />
      </div>

      <div className="mt-8 flex gap-1 rounded-full border hairline p-1">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
              tab === k ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="scroll-thin mt-4 overflow-x-auto rounded-2xl border hairline">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="border-b hairline">
            <tr>{(tab === "deposits" ? ["User", "Amount", "Status", "Credited", "Phone", "When"]
                : tab === "users" ? ["Email", "Name", "Phone", "Deposits", "Joined"]
                : ["User", "Side", "Asset", "Amount", "Status", "Tx"]).map((h, i) => (
              <th key={h} className={`px-3 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {tab === "deposits" && data.deposits.map((d) => (
              <tr key={d.id} className="border-b hairline last:border-0">
                <td className="px-3 py-3">{d.email}</td>
                <td className="tnum px-3 py-3 text-right">{TZS(d.amount_tzs)}</td>
                <td className="px-3 py-3 text-right">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                    d.status === "settled" ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
                    : d.status === "failed" ? "bg-[var(--color-down)]/10 text-[var(--color-down)]"
                    : "surface text-[var(--muted)]"}`} title={d.error ?? undefined}>{d.status}</span>
                </td>
                <td className="tnum px-3 py-3 text-right">{d.usdc_credited ? usd(Number(d.usdc_credited)) : "—"}</td>
                <td className="tnum px-3 py-3 text-right text-[var(--muted)]">{d.phone}</td>
                <td className="tnum px-3 py-3 text-right text-[11px] text-[var(--muted)]">
                  {new Date(d.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </td>
              </tr>
            ))}
            {tab === "users" && data.users.map((u) => (
              <tr key={u.id} className="border-b hairline last:border-0">
                <td className="px-3 py-3">{u.email}</td>
                <td className="px-3 py-3 text-right text-[var(--muted)]">{u.name ?? "—"}</td>
                <td className="tnum px-3 py-3 text-right text-[var(--muted)]">{u.phone ?? "—"}</td>
                <td className="tnum px-3 py-3 text-right">{u.deposits}</td>
                <td className="tnum px-3 py-3 text-right text-[11px] text-[var(--muted)]">
                  {new Date(u.created_at).toLocaleDateString("en-GB")}
                </td>
              </tr>
            ))}
            {tab === "orders" && data.orders.map((o) => (
              <tr key={o.id} className="border-b hairline last:border-0">
                <td className="px-3 py-3">{o.email}</td>
                <td className="px-3 py-3 text-right capitalize">{o.side}</td>
                <td className="px-3 py-3 text-right">{o.symbol}</td>
                <td className="tnum px-3 py-3 text-right">
                  {o.side === "buy" ? usd(Number(o.usdc_amount ?? 0)) : Number(o.qty ?? 0).toFixed(6)}
                </td>
                <td className="px-3 py-3 text-right text-[var(--muted)]">{o.status}</td>
                <td className="px-3 py-3 text-right">
                  {o.tx_hash
                    ? <a href={`https://basescan.org/tx/${o.tx_hash}`} target="_blank" rel="noreferrer" className="text-[11px] underline">view ↗</a>
                    : <span className="text-[11px] text-[var(--muted)]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg)] px-3 py-3 sm:px-5 sm:py-4">
      <div className="eyebrow truncate">{label}</div>
      <div className="tnum mt-1.5 text-base font-medium sm:text-lg">{value}</div>
    </div>
  );
}
