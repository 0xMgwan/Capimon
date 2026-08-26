"use client";

import { useCallback, useEffect, useState } from "react";
import { usd } from "@/lib/format";

type Admin = {
  totals: { users: number; pendingDeposits: number; settledTzs: number; creditedUsdc: number };
  solvency: { ok: boolean; totals: { owedUsd: number; heldUsd: number; shortfallUsd: number };
              assets: { asset: string; owed: number; held: number; covered: boolean }[];
              unavailable?: string } | null;
  totalsExtra: { settledOrders: number; failedOrders: number };
  ntzs: { available: true; source: string; tzs: number; usdc: number; walletAddress: string | null }
      | { available: false; reason: string } | null;
  onchain: { address: string; usdc: number; holdings: { asset: string; qty: number }[] } | null;
  capabilities: Record<string, { available: boolean; detail?: string }> | null;
  collectionRoute: string | null;
  holdingsByAsset: { asset: string; qty: string; holders: number }[];
  ledgerTotals: { asset: string; total: string; entries: number }[];
  withdrawals: { id: string; email: string; amount: string; ref: string | null; created_at: string }[];
  treasury: string | null;
  reconciliation: { credited: string | null; ledger: string | null; deposits: number }[];
  deposits: { id: string; email: string; name: string | null; nida_number: string | null;
              amount_tzs: number; status: string; usdc_credited: string | null; phone: string;
              account_phone: string | null; error: string | null; created_at: string; settled_at: string | null;
              ntzs_deposit_id: string | null; ntzs_status: string | null; ntzs_reference: string | null;
              swap_ref: string | null; transfer_tx: string | null; rate_tzs_usdc: string | null }[];
  users: { id: string; email: string; name: string | null; phone: string | null; nida_number: string | null;
           deposits: number; settled_tzs: number; usdc_balance: string | null; created_at: string }[];
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
  const [tab, setTab] = useState<"deposits" | "users" | "orders" | "holdings" | "withdrawals">("deposits");
  const [openRow, setOpenRow] = useState<string | null>(null);

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
    ["holdings", `Holdings (${data.holdingsByAsset?.length ?? 0})`],
    ["withdrawals", `Withdrawals (${data.withdrawals?.length ?? 0})`],
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

      {(() => {
        const r = data.reconciliation?.[0];
        if (!r) return null;
        const credited = Number(r.credited ?? 0);
        const ledger = Number(r.ledger ?? 0);
        const drift = Math.abs(credited - ledger);
        const matched = drift < 0.01;
        return (
          <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
            matched ? "hairline" : "border-[var(--color-down)]/50 bg-[var(--color-down)]/[0.07]"}`}>
            <span className={matched ? "text-[var(--muted)]" : "text-[var(--color-down)] font-medium"}>
              {matched
                ? `Deposits reconcile: ${r.deposits} settled, ${usd(credited)} credited and ${usd(ledger)} in the ledger.`
                : `Deposits do NOT reconcile — ${usd(credited)} credited against ${usd(ledger)} in the ledger (${usd(drift)} adrift).`}
            </span>
          </div>
        );
      })()}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Shillings sit at nTZS; shares and USDC sit onchain. */}
        <div className="rounded-2xl border hairline p-5">
          <div className="eyebrow">Held at nTZS</div>
          {!data.ntzs ? (
            <p className="mt-2 text-sm text-[var(--muted)]">nTZS is not configured.</p>
          ) : data.ntzs.available ? (
            <>
              <div className="tnum mt-2 text-2xl font-medium">{TZS(data.ntzs.tzs)}</div>
              <div className="tnum mt-1 text-xs text-[var(--muted)]">
                {usd(data.ntzs.usdc)} USDC · source: {data.ntzs.source}
              </div>
              {data.ntzs.walletAddress && (
                <div className="tnum mt-1 truncate text-[11px] text-[var(--muted)]">{data.ntzs.walletAddress}</div>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-[#b45309]">Not readable — {data.ntzs.reason}</p>
          )}
          <div className="mt-3 border-t hairline pt-3 text-[11px] text-[var(--muted)]">
            Collection route: <span className="text-[var(--fg)]">{data.collectionRoute ?? "unknown"}</span>
            {data.capabilities && (
              <span className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(data.capabilities).map(([k, v]) => (
                  <span key={k} title={v.detail}
                    className={`rounded-full px-2 py-0.5 ${v.available
                      ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
                      : "surface text-[var(--muted)]"}`}>
                    {k}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-2xl border hairline p-5">
          <div className="eyebrow">Held onchain</div>
          {data.onchain ? (
            <>
              <div className="tnum mt-2 text-2xl font-medium">{usd(data.onchain.usdc)}</div>
              <div className="tnum mt-1 truncate text-[11px] text-[var(--muted)]">{data.onchain.address}</div>
              <div className="tnum mt-3 flex flex-wrap gap-1.5 text-[11px]">
                {data.onchain.holdings.length === 0
                  ? <span className="text-[var(--muted)]">No shares held</span>
                  : data.onchain.holdings.map((h) => (
                      <span key={h.asset} className="rounded-full surface px-2 py-0.5">
                        {h.asset} {h.qty.toFixed(4)}
                      </span>
                    ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted)]">No treasury configured.</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-6">
        <Cell label="Users" value={String(data.totals.users)} />
        <Cell label="Pending" value={String(data.totals.pendingDeposits)} />
        <Cell label="Collected" value={TZS(data.totals.settledTzs)} />
        <Cell label="Credited" value={usd(data.totals.creditedUsdc)} />
        <Cell label="Orders" value={String(data.totalsExtra?.settledOrders ?? 0)} />
        <Cell label="Failed" value={String(data.totalsExtra?.failedOrders ?? 0)} />
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
                : tab === "users" ? ["User", "National ID", "Phone", "Deposits", "Balance"]
                : tab === "holdings" ? ["Asset", "Owed to clients", "Holders", "Onchain", "Covered"]
                : tab === "withdrawals" ? ["User", "Amount", "Reference", "When"]
                : ["User", "Side", "Asset", "Amount", "Status", "Tx"]).map((h, i) => (
              <th key={h} className={`px-3 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {tab === "deposits" && data.deposits.map((d) => (
              <>
              <tr key={d.id} onClick={() => setOpenRow(openRow === d.id ? null : d.id)}
                  className="cursor-pointer border-b hairline last:border-0 hover:surface">
                <td className="px-3 py-3">
                  <div className="font-medium">{d.name ?? d.email}</div>
                  <div className="text-[11px] text-[var(--muted)]">{d.email}</div>
                </td>
                <td className="tnum px-3 py-3 text-right">{TZS(d.amount_tzs)}</td>
                <td className="px-3 py-3 text-right">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                    d.status === "settled" ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
                    : d.status === "failed" ? "bg-[var(--color-down)]/10 text-[var(--color-down)]"
                    : "surface text-[var(--muted)]"}`} title={d.error ?? undefined}>{d.status}</span>
                  {d.ntzs_status && d.ntzs_status !== d.status && (
                    <span className="ml-1 rounded-full bg-[#b45309]/15 px-2 py-0.5 text-[11px] text-[#b45309]">
                      nTZS: {d.ntzs_status}
                    </span>
                  )}
                </td>
                <td className="tnum px-3 py-3 text-right">{d.usdc_credited ? usd(Number(d.usdc_credited)) : "—"}</td>
                <td className="tnum px-3 py-3 text-right text-[var(--muted)]">{d.phone}</td>
                <td className="tnum px-3 py-3 text-right text-[11px] text-[var(--muted)]">
                  {new Date(d.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </td>
              </tr>
              {openRow === d.id && (
                <tr key={`${d.id}-detail`} className="border-b hairline surface">
                  <td colSpan={6} className="px-3 py-4">
                    <div className="grid gap-4 text-[12px] sm:grid-cols-2">
                      <div>
                        <div className="eyebrow mb-2">Depositor (CAPX KYC)</div>
                        <Detail k="Name" v={d.name} />
                        <Detail k="Email" v={d.email} />
                        <Detail k="National ID" v={d.nida_number} />
                        <Detail k="Account phone" v={d.account_phone} />
                        <Detail k="Paid from" v={d.phone} />
                      </div>
                      <div>
                        <div className="eyebrow mb-2">nTZS trail</div>
                        <Detail k="nTZS deposit id" v={d.ntzs_deposit_id} mono />
                        <Detail k="nTZS status" v={d.ntzs_status} />
                        <Detail k="Provider ref" v={d.ntzs_reference} mono />
                        <Detail k="Swap ref" v={d.swap_ref} mono />
                        <Detail k="Transfer to treasury" v={d.transfer_tx} mono link={d.transfer_tx ? `https://basescan.org/tx/${d.transfer_tx}` : undefined} />
                        <Detail k="Rate" v={d.rate_tzs_usdc ? `1 TZS = ${Number(d.rate_tzs_usdc).toFixed(8)} USDC` : null} />
                        <Detail k="Settled" v={d.settled_at ? new Date(d.settled_at).toLocaleString("en-GB") : null} />
                        {d.error && <Detail k="Error" v={d.error} />}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </>
            ))}
            {tab === "users" && data.users.map((u) => (
              <tr key={u.id} className="border-b hairline last:border-0">
                <td className="px-3 py-3">
                  <div className="font-medium">{u.name ?? "—"}</div>
                  <div className="text-[11px] text-[var(--muted)]">{u.email}</div>
                </td>
                <td className="tnum px-3 py-3 text-right text-[var(--muted)]">{u.nida_number ?? "—"}</td>
                <td className="tnum px-3 py-3 text-right text-[var(--muted)]">{u.phone ?? "—"}</td>
                <td className="tnum px-3 py-3 text-right">
                  {u.deposits} · {TZS(u.settled_tzs)}
                </td>
                <td className="tnum px-3 py-3 text-right">{usd(Number(u.usdc_balance ?? 0))}</td>
              </tr>
            ))}
            {tab === "holdings" && (data.holdingsByAsset ?? []).map((h) => {
              const owed = Math.abs(Number(h.qty));
              const held = data.onchain?.holdings.find((x) => x.asset === h.asset)?.qty ?? 0;
              const covered = held + 1e-8 >= owed;
              return (
                <tr key={h.asset} className="border-b hairline last:border-0">
                  <td className="px-3 py-3 font-medium">{h.asset}</td>
                  <td className="tnum px-3 py-3 text-right">{owed.toFixed(6)}</td>
                  <td className="tnum px-3 py-3 text-right">{h.holders}</td>
                  <td className="tnum px-3 py-3 text-right">{held.toFixed(6)}</td>
                  <td className="px-3 py-3 text-right">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${covered
                      ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
                      : "bg-[var(--color-down)]/10 text-[var(--color-down)]"}`}>
                      {covered ? "covered" : "short"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {tab === "withdrawals" && (data.withdrawals ?? []).map((w) => (
              <tr key={w.id} className="border-b hairline last:border-0">
                <td className="px-3 py-3">{w.email}</td>
                <td className="tnum px-3 py-3 text-right">{TZS(Math.abs(Number(w.amount)))}</td>
                <td className="tnum px-3 py-3 text-right text-[11px] text-[var(--muted)]">{w.ref ?? "—"}</td>
                <td className="tnum px-3 py-3 text-right text-[11px] text-[var(--muted)]">
                  {new Date(w.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
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

function Detail({ k, v, mono, link }: { k: string; v: string | null | undefined; mono?: boolean; link?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b hairline py-1.5 last:border-0">
      <span className="shrink-0 text-[var(--muted)]">{k}</span>
      {link && v ? (
        <a href={link} target="_blank" rel="noreferrer" className={`truncate underline ${mono ? "tnum" : ""}`}>{v}</a>
      ) : (
        <span className={`truncate text-right ${mono ? "tnum" : ""}`}>{v ?? "—"}</span>
      )}
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
