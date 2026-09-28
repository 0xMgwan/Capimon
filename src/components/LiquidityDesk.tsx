"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A liquidity provider's own desk.
 *
 * They have agreed to buy inventory automatically, which means money leaves
 * their balance while they are not looking. Two things follow from that, and
 * this page is both of them: an account of every fill the standing bid took on
 * their behalf, and a switch that stops it.
 *
 * The switch is first and it is theirs alone. A provider who cannot pause
 * without emailing somebody does not have a facility, they have an obligation,
 * and the first market they wanted out of would be the last one they took part
 * in.
 *
 * CAPX opens the same page with the admin token and sees every provider, plus
 * the terms — committed size, the daily cap, the floor, the price band — since
 * those are the agreement rather than the provider's own controls.
 */

type Holding = { symbol: string; qty: number; markTzs: number; valueTzs: number; paidTzs: number };
type Fill = { symbol: string; qty: number; tzs: number; at: string };
type Provider = {
  id: string; name: string; active: boolean;
  committedTzs: number | null; maxDailyTzs: number | null;
  floorTzs: number; bandPct: number | null;
  availableTzs: number; cashTzs: number; inventoryTzs: number; drawnTodayTzs: number;
  reason: string | null;
  holdings: Holding[]; fills: Fill[];
};

const tzs = (n: number) => `${Math.round(n).toLocaleString()} TZS`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Africa/Dar_es_Salaam",
  });

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border hairline p-4">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-lg font-medium tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div>}
    </div>
  );
}

export function LiquidityDesk() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<{ admin: boolean; providers: Provider[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (t: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/lp?token=${encodeURIComponent(t)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.code === "unauthorised" ? "That token was not accepted." : j.error);
      setData({ admin: !!j.admin, providers: j.providers ?? [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open the desk.");
    } finally {
      setBusy(false);
    }
  }, []);

  /* The numbers move when customers trade, so the page keeps up on its own —
     a provider watching a drawdown should not have to reload to see it. */
  useEffect(() => {
    if (!data || !token) return;
    const id = setInterval(() => void load(token), 30_000);
    return () => clearInterval(id);
  }, [data, token, load]);

  /* Onboarding, and the one moment the token exists in a readable form. */
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [issued, setIssued] = useState<{ token: string; warning?: string } | null>(null);

  const create = async () => {
    setBusy(true); setErr(null); setIssued(null);
    try {
      const r = await fetch("/api/lp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "create", name: newName, email: newEmail }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not add that provider.");
      setIssued({ token: j.token, warning: j.warning });
      setNewName(""); setNewEmail("");
      await load(token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add that provider.");
    } finally {
      setBusy(false);
    }
  };

  const setTerm = async (p: Provider, field: string, raw: string) => {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) return;
    setBusy(true);
    try {
      await fetch("/api/lp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: p.id, [field]: value }),
      });
      await load(token);
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (p: Provider, active: boolean) => {
    setBusy(true);
    try {
      await fetch("/api/lp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: p.id, active }),
      });
      await load(token);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
        <div className="eyebrow">Liquidity</div>
        <h1 className="display mt-3 text-3xl">Provider desk.</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          The standing bid: what it has bought, what it is holding, and the switch that stops it.
        </p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(token); }}
          type="password" placeholder="Access token"
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
    <div className="mx-auto max-w-[1100px] px-5 pb-24 pt-6 sm:px-8 sm:pt-12">
      <div className="eyebrow">Liquidity{data.admin && " · viewing as CAPX"}</div>
      <h1 className="display mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">Provider desk.</h1>
      <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
        When a customer cashes out, the shillings that pay them come from the balance you have
        funded here. The standing bid then buys the shares they handed back, at the published mark,
        so what you put in becomes a position rather than a loan the float still owes you.
        You hold that position until you sell it — nothing unwinds it for you — and that is where
        the return is: you bought at the mark on a day somebody needed to exit.
      </p>

      {!data.providers.length && (
        <p className="mt-8 text-sm text-[var(--muted)]">No providers are set up yet.</p>
      )}

      {data.providers.map((p) => {
        const heldValue = p.holdings.reduce((s, h) => s + h.valueTzs, 0);
        const heldCost = p.holdings.reduce((s, h) => s + h.paidTzs, 0);
        const pnl = heldValue - heldCost;
        return (
          <section key={p.id} className="mt-10 rounded-3xl border hairline p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-medium">{p.name}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {p.active
                    ? p.availableTzs > 0
                      ? `Bidding. Up to ${tzs(p.availableTzs)} can be called on right now.`
                      : `Bidding, but nothing can be called on — ${p.reason}.`
                    : "Paused. Nothing will be bought until this is switched back on."}
                </p>
              </div>
              <button
                onClick={() => void setActive(p, !p.active)}
                disabled={busy}
                className={`rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-50 ${
                  p.active
                    ? "border hairline"
                    : "bg-[var(--fg)] text-[var(--bg)]"
                }`}
              >
                {p.active ? "Pause the bid" : "Resume the bid"}
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Available now" value={tzs(p.availableTzs)}
                    hint={p.reason ?? "the tightest of your limits"} />
              <Stat label="Cash balance" value={tzs(p.cashTzs)}
                    hint={p.floorTzs > 0 ? `floor ${tzs(p.floorTzs)}` : "no floor set"} />
              <Stat label="Inventory held" value={tzs(p.inventoryTzs)}
                    hint={p.committedTzs === null ? "no committed size set" : `of ${tzs(p.committedTzs)} committed`} />
              <Stat label="Bought today" value={tzs(p.drawnTodayTzs)}
                    hint={p.maxDailyTzs === null ? "no daily limit set" : `of ${tzs(p.maxDailyTzs)}`} />
            </div>

            {p.holdings.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-medium">Position</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  What the bid has taken on, at cost and at today&apos;s marks. The difference is
                  unrealised — it becomes shillings when you sell, which is yours to decide.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                      <tr>
                        <th className="pb-2 font-normal">Security</th>
                        <th className="pb-2 text-right font-normal">Shares</th>
                        <th className="pb-2 text-right font-normal">Paid</th>
                        <th className="pb-2 text-right font-normal">Worth now</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {p.holdings.map((h) => (
                        <tr key={h.symbol} className="border-t hairline">
                          <td className="py-2.5">{h.symbol}</td>
                          <td className="py-2.5 text-right">{h.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                          <td className="py-2.5 text-right">{tzs(h.paidTzs)}</td>
                          <td className="py-2.5 text-right">{tzs(h.valueTzs)}</td>
                        </tr>
                      ))}
                      <tr className="border-t hairline font-medium">
                        <td className="py-2.5">Total</td>
                        <td />
                        <td className="py-2.5 text-right">{tzs(heldCost)}</td>
                        <td className="py-2.5 text-right">
                          {tzs(heldValue)}
                          <span className={`ml-2 text-xs ${pnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                            {pnl >= 0 ? "+" : "−"}{tzs(Math.abs(pnl))}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-8">
              <h3 className="text-sm font-medium">Fills</h3>
              {!p.fills.length ? (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  The bid has not been called on. That is the normal state: it fires only when the
                  shillings owed across the book exceed the shillings held, which a cash-out is the
                  usual way of causing.
                </p>
              ) : (
                <ul className="mt-3 divide-y hairline text-sm">
                  {p.fills.map((f, i) => (
                    <li key={`${f.at}-${i}`} className="flex items-baseline justify-between gap-4 py-2.5">
                      <span>
                        {f.symbol}
                        <span className="ml-2 text-xs text-[var(--muted)]">
                          {f.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
                        </span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        {tzs(f.tzs)}
                        <span className="ml-3 text-xs text-[var(--muted)]">{when(f.at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {data.admin && (
              <div className="mt-8 border-t hairline pt-5">
                <h3 className="text-sm font-medium">Terms</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Blank means no limit agreed, and nothing is enforced on that ground. Each one is
                  checked the moment it is set.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Term label="Committed size (TZS)" value={p.committedTzs}
                        onSave={(v) => void setTerm(p, "committedTzs", v)} busy={busy} />
                  <Term label="Daily limit (TZS)" value={p.maxDailyTzs}
                        onSave={(v) => void setTerm(p, "maxDailyTzs", v)} busy={busy} />
                  <Term label="Balance floor (TZS)" value={p.floorTzs}
                        onSave={(v) => void setTerm(p, "floorTzs", v)} busy={busy} />
                  <Term label="Price band (%)" value={p.bandPct}
                        onSave={(v) => void setTerm(p, "bandPct", v)} busy={busy} />
                </div>
              </div>
            )}
          </section>
        );
      })}

      {data.admin && (
        <section className="mt-10 rounded-3xl border hairline p-5 sm:p-7">
          <h2 className="text-lg font-medium">Add a provider</h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--muted)]">
            They sign up as an ordinary CAPX user, verify, and fund that account with shillings.
            Adding them here turns that account into a provider — there is no separate signup,
            because the facility is funded by that same balance sitting in the omnibus, which is
            what lets the bid settle instantly instead of waiting on a transfer.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Name, e.g. FIMCO"
              className="min-w-[180px] flex-1 rounded-xl border hairline bg-transparent px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <input
              value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Account email" type="email"
              className="min-w-[220px] flex-1 rounded-xl border hairline bg-transparent px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={() => void create()} disabled={busy || !newName || !newEmail}
              className="rounded-full bg-[var(--fg)] px-6 py-2.5 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {issued && (
            <div className="mt-4 rounded-2xl border hairline p-4">
              <div className="text-xs text-[var(--muted)]">
                Their access token. Only its hash is stored, so this is the one time it can be read —
                send it to them over something private, not email.
              </div>
              <code className="mt-2 block break-all text-sm">{issued.token}</code>
              {issued.warning && (
                <p className="mt-2.5 text-xs text-[#b45309]">{issued.warning}</p>
              )}
            </div>
          )}
          {err && <p className="mt-3 text-xs text-[var(--color-down)]">{err}</p>}
        </section>
      )}
    </div>
  );
}

/**
 * One term, edited in place.
 *
 * Empty is a real value here — it clears the limit — so the field cannot fall
 * back to a default when it is blank, and the save is explicit rather than
 * on every keystroke.
 */
function Term({ label, value, onSave, busy }: {
  label: string; value: number | null; onSave: (v: string) => void; busy: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const dirty = text !== (value === null ? "" : String(value));
  return (
    <div className="rounded-2xl border hairline p-3">
      <label className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && dirty) onSave(text); }}
          inputMode="decimal" placeholder="none"
          className="w-full bg-transparent text-sm tabular-nums outline-none"
        />
        {dirty && (
          <button
            onClick={() => onSave(text)} disabled={busy}
            className="shrink-0 rounded-full border hairline px-3 py-1 text-xs disabled:opacity-50"
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
}
