"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

/**
 * Standing orders, from the customer's side.
 *
 * The case for this is not the feature, it is the habit: a little on payday
 * beats a decision every month, and it is the difference between an app
 * somebody tried once and one they are still using in a year.
 *
 * Deliberately plain about what it will not do. It spends the shillings
 * already in the account — it never pulls money from anyone's phone — and
 * when the balance is short it says so and waits for the next date rather
 * than half-filling an order nobody asked for.
 */
type Plan = {
  id: string; symbol: string; amountTzs: number; cadence: "weekly" | "monthly";
  dayOf: number; nextRun: string; status: string; lastError: string | null;
  runs: number; misses: number;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/*
 * Built from translated parts rather than a finished sentence, because a
 * sentence assembled here would never be found in the dictionary and every
 * plan would read in English on a Swahili page.
 */
const when = (p: Plan, t: (s: string) => string) =>
  p.cadence === "weekly"
    ? `${t("every")} ${t(DAYS[((p.dayOf % 7) + 7) % 7])}`
    : `${t("day")} ${p.dayOf} ${t("of each month")}`;

const dt = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function RecurringBuys({ securities }: { securities: { symbol: string; name: string }[] }) {
  const { t } = useT();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({
    symbol: securities[0]?.symbol ?? "CRDB",
    amount: "50000",
    cadence: "monthly" as "weekly" | "monthly",
    dayOf: 1,
  });

  useEffect(() => {
    let alive = true;
    fetch("/api/account/recurring", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive) setPlans(j?.ok ? j.plans : []); })
      .catch(() => { if (alive) setPlans([]); });
    return () => { alive = false; };
  }, []);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/account/recurring", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? t("Could not save your plan"));
      setPlans(j.plans); setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  };

  // Nothing listed yet: do not offer a plan for a market that has none.
  if (!securities.length) return null;

  return (
    <section className="mt-3 rounded-2xl border hairline p-3.5 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">{t("Automatic investing")}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
            {t("Buy the same amount on the same day, without thinking about it.")}
          </p>
        </div>
        <button
          onClick={() => { haptic(); setOpen((v) => !v); setErr(null); }}
          className="shrink-0 rounded-full border hairline px-3.5 py-1.5 text-[12px] font-medium hover:surface"
        >
          {open ? t("Close") : t("New plan")}
        </button>
      </div>

      {open && (
        <div className="mt-3 rounded-2xl surface p-3.5">
          <label className="block">
            <span className="eyebrow">{t("Share")}</span>
            <select
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              {securities.map((s) => (
                <option key={s.symbol} value={s.symbol}>{s.symbol} · {s.name}</option>
              ))}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="eyebrow">{t("Amount each time")}</span>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                inputMode="numeric"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9]/g, "") })}
                className="min-w-0 flex-1 rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <span className="text-[12px] text-[var(--muted)]">TZS</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[20_000, 50_000, 100_000, 250_000].map((n) => (
                <button key={n} onClick={() => { haptic(); setForm({ ...form, amount: String(n) }); }}
                  className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                    form.amount === String(n) ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                  }`}>
                  {n.toLocaleString()}
                </button>
              ))}
            </div>
          </label>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["weekly", "monthly"] as const).map((c) => (
              <button key={c}
                onClick={() => { haptic(); setForm({ ...form, cadence: c, dayOf: c === "weekly" ? 1 : 1 }); }}
                className={`rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors ${
                  form.cadence === c ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                }`}>
                {c === "weekly" ? t("Every week") : t("Every month")}
              </button>
            ))}
          </div>

          <label className="mt-3 block">
            <span className="eyebrow">{form.cadence === "weekly" ? t("Day") : t("Day of the month")}</span>
            {form.cadence === "weekly" ? (
              <select value={form.dayOf} onChange={(e) => setForm({ ...form, dayOf: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]">
                {DAYS.map((d, i) => <option key={d} value={i}>{t(d)}</option>)}
              </select>
            ) : (
              <>
                <select value={form.dayOf} onChange={(e) => setForm({ ...form, dayOf: Number(e.target.value) })}
                  className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <span className="mt-1 block text-[11px] text-[var(--muted)]">
                  {t("The 28th is the last day offered, so every month has one.")}
                </span>
              </>
            )}
          </label>

          {err && <p className="mt-2 text-[12px] text-[var(--color-down)]">{err}</p>}

          <button
            onClick={() => { haptic(); void send({ symbol: form.symbol, amountTzs: Number(form.amount), cadence: form.cadence, dayOf: form.dayOf }); }}
            disabled={busy || !(Number(form.amount) >= 5000)}
            className="mt-3 w-full rounded-full bg-[var(--fg)] py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
          >
            {busy ? t("Saving…") : t("Start plan")}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            {t("It spends the shillings already in your account. If the balance is short that day, nothing is bought and we tell you.")}
          </p>
        </div>
      )}

      {plans && plans.length > 0 && (
        <div className="mt-3 grid gap-1.5">
          {plans.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-2xl border hairline px-3.5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium leading-tight">
                  {Math.round(p.amountTzs).toLocaleString()} TZS → {p.symbol}
                </span>
                <span className="tnum block text-[11px] text-[var(--muted)]">
                  {when(p, t)}
                  {p.status === "active" ? ` · ${t("next")} ${dt(p.nextRun)}` : ` · ${t("paused")}`}
                  {p.runs > 0 && ` · ${p.runs} ${t("bought")}`}
                </span>
                {p.lastError && p.status === "active" && (
                  <span className="block text-[11px] text-[var(--color-down)]">{p.lastError}</span>
                )}
              </span>
              <button onClick={() => { haptic(); void send({ action: p.status === "active" ? "pause" : "resume", id: p.id }); }}
                disabled={busy}
                className="rounded-full border hairline px-3 py-1 text-[11px] hover:surface disabled:opacity-50">
                {p.status === "active" ? t("Pause") : t("Resume")}
              </button>
              <button onClick={() => { haptic(); void send({ action: "cancel", id: p.id }); }}
                disabled={busy}
                className="rounded-full border hairline px-3 py-1 text-[11px] text-[var(--color-down)] hover:surface disabled:opacity-50">
                {t("Cancel")}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
