"use client";

import { useCallback, useEffect, useState } from "react";
import { usd } from "@/lib/format";

/** One identity check, without the images it points at. */
type KycRow = {
  id: string; user_id: string; email: string; name: string | null;
  doc_type: string; doc_number: string | null; status: string; reason: string | null;
  reviewed_by: string | null; reviewed_at: string | null; created_at: string;
  doc_bytes: number; selfie_bytes: number; doc_mime: string;
};

type Admin = {
  totals: { users: number; pendingDeposits: number; settledTzs: number; creditedUsdc: number };
  solvency: { ok: boolean; totals: { owedUsd: number; heldUsd: number; shortfallUsd: number };
              usdc?: { treasury: number; rampFloat: number };
              assets: { asset: string; owed: number; held: number; covered: boolean }[];
              unavailable?: string } | null;
  totalsExtra: { settledOrders: number; failedOrders: number; feesTzs: number };
  fees?: {
    position: { charged: number; swept: number; unswept: number; destination: string | null;
                minimum: number; sweepable: boolean; reason: string | null;
                belowMinimum: boolean } | null;
    sweeps: { id: string; amount_tzs: number; destination: string; status: string;
              tx_hash: string | null; error: string | null; created_at: string }[];
  };
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
  orders: { id: string; email: string; side: string; symbol: string; price: string | null; usdc_amount: string | null;
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
  const [tab, setTab] = useState<"deposits" | "users" | "orders" | "holdings" | "withdrawals" | "kyc">("deposits");
  const [kyc, setKyc] = useState<KycRow[] | null>(null);

  /*
   * Loaded on demand rather than with the dashboard.
   *
   * The listing carries image sizes but not images, so it is small — the reason
   * it is separate is that identity documents should not be fetched at all by
   * an operator who only came to look at deposits.
   */
  const loadKyc = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/kyc", { headers: { authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (j.ok) setKyc(j.submissions);
    } catch { /* the rest of the desk still works */ }
  }, [token]);

  useEffect(() => {
    if (tab !== "kyc" || !token) return;
    // Deferred rather than called in the effect body: a synchronous setState
    // during an effect cascades a second render before the first has painted.
    const id = setTimeout(() => void loadKyc(), 0);
    return () => clearTimeout(id);
  }, [tab, token, loadKyc]);

  const review = async (id: string, approve: boolean) => {
    const reason = approve ? null : window.prompt("Why is this being rejected? The customer is shown this.");
    if (!approve && !reason?.trim()) return;
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/admin/kyc", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, approve, reason }),
      });
      const j = await r.json();
      setNote(j.ok ? `Verification ${j.status}.` : j.error ?? "Review failed.");
      if (j.ok) { await loadKyc(); await load(token); }
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };
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
    await fetch("/api/ntzs/settle", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => {});
    await load(token);
  };

  // Repairs shillings a failed order already converted. The server derives both
  // the amount and the account from the failed order, so there is nothing to
  // mistype here — this only decides when to run it.
  const [note, setNote] = useState<string | null>(null);

  /*
   * Sweeping takes no amount. The figure is the difference between what the
   * trades charged and what has already been moved, so there is nothing here to
   * mistype — this button only decides when.
   */
  const sweep = async (force = false) => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "sweep-fees", force }),
      });
      const j = await r.json();
      setNote(j.ok
        ? `Swept ${Number(j.amount).toLocaleString()} TZS in fees.`
        : j.error ?? "Sweep failed.");
      if (j.ok) await load(token);
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "reconcile-shortfall" }),
      });
      const j = await r.json();
      if (!j.ok) {
        setNote(j.error ?? "Reconciliation failed.");
      } else {
        // Report every part: the precise repair, the measured write-downs, and
        // anything deliberately left alone.
        const lines: string[] = [];
        if (j.drift?.applied) {
          lines.push(`Moved ${j.drift.movedTzs?.toLocaleString()} TZS to ${j.drift.creditedUsdc} USDC ` +
            `on order ${String(j.drift.orderId).slice(0, 8)}.`);
        }
        for (const c of j.corrections ?? []) {
          lines.push(`Reduced ${c.asset} by ${c.asset === "TZS"
            ? Math.round(c.amount).toLocaleString()
            : c.amount.toFixed(6)} to match what is held.`);
        }
        for (const sk of j.skipped ?? []) lines.push(sk);
        setNote(lines.length ? lines.join(" ") : "Nothing to reconcile. Balances match what is held.");
      }
    } catch {
      setNote("Reconciliation failed.");
    }
    await load(token);
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-24">
        <div className="eyebrow">Operations</div>
        <h1 className="display mt-2 text-2xl">Restricted.</h1>
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
    ["kyc", kyc ? `KYC (${kyc.filter((k) => k.status === "pending").length})` : "KYC"],
    ["holdings", `Holdings (${data.holdingsByAsset?.length ?? 0})`],
    ["withdrawals", `Withdrawals (${data.withdrawals?.length ?? 0})`],
  ] as const;

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-7 sm:px-8 sm:pt-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Operations</div>
          <h1 className="display mt-1.5 text-[clamp(1.5rem,3vw,2.1rem)]">Custody desk.</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Only offered when shillings are actually owed beyond what is held. */}
          {/* Offered for any shortfall: money can leave without a debit in more
              than one way, and the repair is measured either way. */}
          {s && !s.ok && !s.unavailable && (
            <button onClick={reconcile} disabled={busy}
              className="rounded-full border border-[var(--color-down)]/50 px-5 py-2.5 text-sm text-[var(--color-down)] transition-colors hover:bg-[var(--color-down)]/[0.06] disabled:opacity-50">
              {busy ? "Working…" : "Reconcile balances to backing"}
            </button>
          )}
          <button onClick={settle} disabled={busy}
            className="rounded-full border hairline px-5 py-2.5 text-sm transition-colors hover:surface disabled:opacity-50">
            {busy ? "Working…" : "Settle pending deposits"}
          </button>
        </div>
      </div>

      {note && (
        <p className="mt-4 rounded-2xl border hairline px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
          {note}
        </p>
      )}

      {/* Solvency leads — it is the number that decides whether anything else matters. */}
      <div className={`mt-5 rounded-3xl border p-5 ${
        !s || s.unavailable ? "hairline"
          : s.ok ? "border-[var(--color-up)]/40 bg-[var(--color-up)]/[0.05]"
                 : "border-[var(--color-down)]/50 bg-[var(--color-down)]/[0.07]"}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="text-sm font-medium">
            {!s || s.unavailable ? "Solvency unavailable"
              : s.ok ? "Client assets are fully backed" : "SHORTFALL. Trading is paused"}
          </div>
          {s?.unavailable && <span className="text-xs text-[var(--muted)]">{s.unavailable}</span>}
        </div>
        {s && !s.unavailable && (
          <>
            {s.usdc && (
              <div className="tnum mt-3 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full surface px-2.5 py-1">
                  treasury {usd(s.usdc.treasury)}
                </span>
                <span className="rounded-full surface px-2.5 py-1">
                  nTZS float {usd(s.usdc.rampFloat)}
                </span>
                {s.usdc.treasury < s.totals.owedUsd && (
                  <span className="rounded-full bg-[#b45309]/15 px-2.5 py-1 text-[#b45309]">
                    backing is in the float, move it to the treasury before trading
                  </span>
                )}
              </div>
            )}
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

      {/*
        * Fees earned, and how much of it is still sitting in customer float.
        *
        * Charged and swept are shown separately rather than as one "revenue"
        * figure: the gap between them is money the business has earned but has
        * not taken out, and that gap is the thing worth acting on.
        */}
      {data.fees?.position && (
        <div className="mt-4 rounded-2xl border hairline px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="tnum grid flex-1 grid-cols-3 gap-4 text-sm">
              <div><div className="eyebrow">Fees charged</div><div className="mt-1">{TZS(data.fees.position.charged)}</div></div>
              <div><div className="eyebrow">Swept out</div><div className="mt-1">{TZS(data.fees.position.swept)}</div></div>
              <div><div className="eyebrow">In float</div>
                <div className="mt-1">{TZS(data.fees.position.unswept)}</div></div>
            </div>
            {/* Forcing is offered only for the minimum — the one refusal an
                operator may reasonably overrule, and what makes it possible to
                test the path before it carries anything worth losing. */}
            <button
              onClick={() => void sweep(data.fees!.position!.belowMinimum)}
              disabled={busy || !(data.fees.position.sweepable || data.fees.position.belowMinimum)}
              title={data.fees.position.reason ?? undefined}
              className="shrink-0 rounded-full border hairline px-4 py-2 text-[13px] font-medium hover:surface disabled:opacity-40"
            >
              {data.fees.position.belowMinimum ? "Sweep anyway" : "Sweep fees"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {data.fees.position.reason
              ?? `Ready to sweep to ${data.fees.position.destination?.slice(0, 10)}…${data.fees.position.destination?.slice(-6)}.`}
          </p>
          {data.fees.sweeps.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              {data.fees.sweeps.map((w) => (
                <span key={w.id} className={`tnum rounded-full px-2.5 py-1 ${
                  w.status === "settled" ? "surface text-[var(--muted)]"
                  : w.status === "failed" ? "bg-[var(--color-down)]/15 text-[var(--color-down)]"
                  : "bg-[#b45309]/15 text-[#b45309]"}`}
                  title={w.error ?? undefined}>
                  {TZS(w.amount_tzs)} · {w.status}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

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
                : `Deposits do NOT reconcile: ${usd(credited)} credited against ${usd(ledger)} in the ledger (${usd(drift)} adrift).`}
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
            <p className="mt-2 text-xs leading-relaxed text-[#b45309]">Not readable. {data.ntzs.reason}</p>
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

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-4 lg:grid-cols-7">
        <Cell label="Users" value={String(data.totals.users)} />
        <Cell label="Pending" value={String(data.totals.pendingDeposits)} />
        <Cell label="Collected" value={TZS(data.totals.settledTzs)} />
        <Cell label="Credited" value={usd(data.totals.creditedUsdc)} />
        <Cell label="Orders" value={String(data.totalsExtra?.settledOrders ?? 0)} />
        <Cell label="Failed" value={String(data.totalsExtra?.failedOrders ?? 0)} />
        {/* Shilling trade fees. They are not swept anywhere — they stay in the
            omnibus and were, until now, visible only as unexplained surplus. */}
        <Cell label="Fees (held)" value={TZS(data.totalsExtra?.feesTzs ?? 0)} />
      </div>

      <div className="mt-6 flex gap-1 overflow-x-auto rounded-full border hairline p-1">
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
                : tab === "kyc" ? ["Applicant", "Document", "Selfie", "Status", "Decision"]
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
              /*
               * Coverage comes from the solvency check, not from the treasury's
               * asset list.
               *
               * That list is the Chainlink-fed US equities. A local security
               * like CRDB has its own token and is not in it, so looking there
               * found nothing, reported zero held against real client holdings,
               * and flagged a fully backed position as short — the same fault
               * that once paused trading for everyone, showing up in a second
               * place because two bits of code were both working out "held".
               * There is now one answer, and this reads it.
               */
              const fromSolvency = data.solvency?.assets.find((a) => a.asset === h.asset);
              const held = fromSolvency?.held
                ?? data.onchain?.holdings.find((x) => x.asset === h.asset)?.qty
                ?? 0;
              const covered = fromSolvency?.covered ?? held + 1e-8 >= owed;
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
            {tab === "kyc" && (kyc ?? []).map((k) => (
              <tr key={k.id} className="border-b hairline last:border-0 align-top">
                <td className="px-3 py-3">
                  <div>{k.email}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {k.name ?? "no name"} · {k.doc_type}
                    {k.doc_number ? ` · ${k.doc_number}` : ""}
                  </div>
                  {k.reason && (
                    <div className="mt-1 text-[11px] text-[var(--color-down)]">{k.reason}</div>
                  )}
                </td>
                {/*
                  * Thumbnails, loaded from a token-gated route.
                  * An identity document is the one thing on this desk that must
                  * not be viewable by anyone who happens to have the URL, so the
                  * image route checks the same token this panel was opened with.
                  */}
                <td className="px-3 py-3" colSpan={2}>
                  <div className="flex gap-2">
                    {(["doc", "selfie"] as const).map((which) => {
                      const href = `/api/admin/kyc/image?id=${k.id}&which=${which}&token=${encodeURIComponent(token)}`;
                      // A PDF has no thumbnail, so it gets a tile that opens it
                      // rather than a broken image where a face should be.
                      const isPdf = which === "doc" && k.doc_mime === "application/pdf";
                      return (
                        <a key={which} href={href} target="_blank" rel="noreferrer"
                          title={`Open ${which} full size`}>
                          {isPdf ? (
                            <span className="grid h-16 w-24 place-items-center rounded-lg border hairline surface text-[11px] font-medium text-[var(--muted)]">
                              PDF ↗
                            </span>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={href}
                              alt={which}
                              className={`h-16 border hairline object-cover ${
                                which === "selfie" ? "w-16 rounded-full" : "w-24 rounded-lg"}`}
                            />
                          )}
                        </a>
                      );
                    })}
                  </div>
                </td>
                <td className="px-3 py-3 text-right text-[var(--muted)]">{k.status}</td>
                <td className="px-3 py-3 text-right">
                  {k.status === "pending" ? (
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => void review(k.id, true)}
                        disabled={busy}
                        className="rounded-full border border-[var(--color-up)]/50 px-3 py-1 text-[11px] text-[var(--color-up)] hover:bg-[var(--color-up)]/10 disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => void review(k.id, false)}
                        disabled={busy}
                        className="rounded-full border border-[var(--color-down)]/50 px-3 py-1 text-[11px] text-[var(--color-down)] hover:bg-[var(--color-down)]/10 disabled:opacity-40"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-[var(--muted)]">
                      {k.reviewed_by ?? "—"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {tab === "kyc" && kyc && kyc.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-[var(--muted)]">
                No verification submissions yet.
              </td></tr>
            )}
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
                {/*
                  * A shilling-settled order has no dollar amount, so reading
                  * this column as USDC printed $0.00 against a real trade. The
                  * value is shown in whatever the order actually settled in.
                  */}
                <td className="tnum px-3 py-3 text-right">
                  {o.usdc_amount != null
                    ? (o.side === "buy" ? usd(Number(o.usdc_amount)) : Number(o.qty ?? 0).toFixed(6))
                    : o.price != null
                      ? `${Number(o.qty ?? 0)} @ ${Number(o.price).toLocaleString()} TZS`
                      : Number(o.qty ?? 0).toFixed(6)}
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
