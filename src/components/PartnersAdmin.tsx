"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * CAPX's side: who has applied, and who is allowed to move money.
 *
 * Approving is the single moment a company stops being an application and
 * starts being able to spend a customer's balance, so it is one explicit
 * button with the live key shown once and mailed to them — not a status
 * dropdown that could be changed by accident while scrolling.
 */

type Usage = {
  users: number; verified: number; orders: number;
  volumeTzs: number; volumeUsdc: number;
  funding?: { deposits: number; collectedTzs: number;
              transferredTzs: number; transferredUsdc: number };
  holdings?: { asset: string; qty: number; holders: number }[];
} | null;
type Partner = {
  id: string; name: string; slug: string; status: string;
  contactName: string | null; contactEmail: string; contactPhone: string | null;
  companyReg: string | null; country: string; website: string | null;
  useCase: string | null; expectedUsers: number | null;
  feeBps: number; maxOrderTzs: number | null; maxDailyTzs: number | null;
  webhookUrl: string | null; createdAt: string; usage: Usage;
};

const tzs = (n: number) => `${Math.round(n).toLocaleString()} TZS`;

const TONE: Record<string, string> = {
  approved: "text-[var(--color-up)]",
  pending: "text-[#b45309]",
  suspended: "text-[var(--color-down)]",
  rejected: "text-[var(--muted)]",
};

export function PartnersAdmin() {
  const [token, setToken] = useState("");
  const [list, setList] = useState<Partner[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);

  const load = useCallback(async (t: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/partners?token=${encodeURIComponent(t)}`,
        { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.code === "unauthorised" ? "That token was not accepted." : j.error);
      setList(j.partners ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the partners.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!list || !token) return;
    const id = setInterval(() => void load(token), 60_000);
    return () => clearInterval(id);
  }, [list, token, load]);

  const act = async (p: Partner, body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: p.id, ...body }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "That did not work.");
      if (j.live_key) setIssued({ name: p.name, key: j.live_key });
      await load(token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reach the server.");
    } finally { setBusy(false); }
  };

  const term = (p: Partner, field: string, label: string, value: number | null) => (
    <label className="rounded-2xl border hairline p-3">
      <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <input
        defaultValue={value === null ? "" : String(value)}
        placeholder="none"
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const next = raw === "" ? null : Number(raw);
          if (next !== null && !Number.isFinite(next)) return;
          if (next === value) return;
          void act(p, { [field]: next });
        }}
        inputMode="decimal"
        className="mt-1 w-full bg-transparent text-sm tabular-nums outline-none"
      />
    </label>
  );

  if (!list) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
        <div className="eyebrow">Operations</div>
        <h1 className="display mt-3 text-3xl">Partners.</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Applications, approvals and the commercial terms.
        </p>
        <input
          value={token} onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(token); }}
          type="password" placeholder="Admin token"
          className="mt-6 w-full rounded-xl border hairline bg-transparent px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          onClick={() => void load(token)} disabled={busy || !token}
          className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
        >
          {busy ? "Checking…" : "Open"}
        </button>
        {err && <p className="mt-3 text-xs text-[var(--color-down)]">{err}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 pt-6 sm:px-8 sm:pt-12">
      <div className="eyebrow">Operations</div>
      <h1 className="display mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">Partners.</h1>

      {issued && (
        <div className="mt-6 rounded-2xl border hairline p-4">
          <div className="text-xs text-[var(--muted)]">
            Live key for <b>{issued.name}</b> — shown once here and mailed to their contact address.
          </div>
          <code className="mt-2 block break-all text-sm">{issued.key}</code>
        </div>
      )}

      {!list.length && (
        <p className="mt-8 text-sm text-[var(--muted)]">Nobody has applied yet.</p>
      )}

      {list.map((p) => (
        <section key={p.id} className="mt-8 rounded-3xl border hairline p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-xl font-medium">{p.name}</h2>
                <span className={`text-xs ${TONE[p.status] ?? ""}`}>{p.status}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {p.contactName ? `${p.contactName} · ` : ""}{p.contactEmail}
                {p.contactPhone ? ` · ${p.contactPhone}` : ""}
                {" · "}{p.country}
                {p.companyReg ? ` · reg ${p.companyReg}` : ""}
                {p.website ? <> · <a href={p.website} target="_blank" rel="noreferrer"
                   className="underline underline-offset-2">{p.website}</a></> : null}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Applied {new Date(p.createdAt).toLocaleDateString("en-GB")}
                {p.expectedUsers ? ` · expects ${p.expectedUsers.toLocaleString()} customers` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {p.status !== "approved" && (
                <button onClick={() => void act(p, { status: "approved" })} disabled={busy}
                        className="rounded-full bg-[var(--fg)] px-4 py-2 text-xs font-medium text-[var(--bg)] disabled:opacity-50">
                  Approve &amp; issue live key
                </button>
              )}
              {p.status === "approved" && (
                <button onClick={() => void act(p, { status: "suspended" })} disabled={busy}
                        className="rounded-full border hairline px-4 py-2 text-xs font-medium disabled:opacity-50">
                  Suspend
                </button>
              )}
              {p.status !== "rejected" && p.status !== "approved" && (
                <button onClick={() => void act(p, { status: "rejected" })} disabled={busy}
                        className="rounded-full border hairline px-4 py-2 text-xs disabled:opacity-50">
                  Decline
                </button>
              )}
              {p.status === "suspended" && (
                <button onClick={() => void act(p, { status: "approved" })} disabled={busy}
                        className="rounded-full border hairline px-4 py-2 text-xs disabled:opacity-50">
                  Reinstate
                </button>
              )}
            </div>
          </div>

          {p.useCase && (
            <div className="mt-4 rounded-2xl surface p-3.5">
              <div className="eyebrow">What they want to build</div>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{p.useCase}</p>
            </div>
          )}

          {p.usage && (
            <>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
                <span>{p.usage.users.toLocaleString()} customers</span>
                <span>{p.usage.verified.toLocaleString()} verified</span>
                <span>{p.usage.orders.toLocaleString()} orders</span>
                <span className="tabular-nums">{tzs(p.usage.volumeTzs)} traded</span>
                <span className="tabular-nums">
                  ${p.usage.volumeUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} traded
                </span>
                {p.webhookUrl && <span>webhook set</span>}
              </div>

              {/*
                * How their money arrived, split by rail.
                *
                * A partner paying in nTZS is a different operational fact from
                * their customers running mobile money collections — one is a
                * transfer the desk can see on chain, the other had to settle
                * — so the two are never added together here.
                */}
              {p.usage.funding && p.usage.funding.deposits > 0 && (
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl surface px-3.5 py-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                      Collected (mobile money, bank)
                    </div>
                    <div className="tnum mt-0.5 text-sm">{tzs(p.usage.funding.collectedTzs)}</div>
                  </div>
                  <div className="rounded-xl surface px-3.5 py-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                      Transferred in nTZS
                    </div>
                    <div className="tnum mt-0.5 text-sm">{tzs(p.usage.funding.transferredTzs)}</div>
                  </div>
                  <div className="rounded-xl surface px-3.5 py-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                      Transferred in USDC
                    </div>
                    <div className="tnum mt-0.5 text-sm">
                      ${p.usage.funding.transferredUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              )}

              {!!p.usage.holdings?.length && (
                <div className="mt-4">
                  <div className="eyebrow">What their customers hold</div>
                  <div className="mt-2 grid gap-1.5">
                    {p.usage.holdings.map((h) => (
                      <div key={h.asset}
                           className="flex items-center gap-3 rounded-xl surface px-3.5 py-2 text-[12px]">
                        <span className="w-16 shrink-0 font-medium">{h.asset}</span>
                        <span className="tnum shrink-0 text-[var(--muted)]">
                          {h.holders} holder{h.holders === 1 ? "" : "s"}
                        </span>
                        <span className="tnum ml-auto">
                          {h.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-5 border-t hairline pt-4">
            <h3 className="text-sm font-medium">Terms</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Blank means no limit is agreed and nothing is refused on that ground. Their fee share
              comes out of CAPX&apos;s slice, so it is capped at 250 bps.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {term(p, "fee_bps", "Fee share (bps, max 250)", p.feeBps)}
              {term(p, "max_order_tzs", "Max single order (TZS)", p.maxOrderTzs)}
              {term(p, "max_daily_tzs", "Max per day (TZS)", p.maxDailyTzs)}
            </div>
          </div>
        </section>
      ))}

      {err && <p className="mt-4 text-xs text-[var(--color-down)]">{err}</p>}
    </div>
  );
}
