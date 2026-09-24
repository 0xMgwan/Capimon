"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { DseLogo } from "./DseLogo";

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
  id: string; symbol: string; amountTzs: number; cadence: "daily" | "weekly" | "monthly";
  dayOf: number; nextRun: string; status: string; lastError: string | null;
  /** When the scheduler last attempted it, whether or not it bought. */
  lastRunAt?: string | null;
  runs: number; misses: number;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/*
 * Built from translated parts rather than a finished sentence, because a
 * sentence assembled here would never be found in the dictionary and every
 * plan would read in English on a Swahili page.
 */
const when = (p: Plan, t: (s: string) => string) =>
  p.cadence === "daily"
    ? t("every day")
    : p.cadence === "weekly"
      ? `${t("every")} ${t(DAYS[((p.dayOf % 7) + 7) % 7])}`
      : `${t("day")} ${p.dayOf} ${t("of each month")}`;

/*
 * The date and the hour.
 *
 * "next 24 Sep" left somebody watching all day to see whether it had
 * happened, and with nothing bought yet there was no way to tell a plan that
 * had not reached its time from one that had failed. Shown in East African
 * time, which is the clock the schedule is set by.
 */
const dt = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).replace(",", " ·");

type Listing = { symbol: string; name: string; logo: string | null; price: number };

/**
 * Choosing the share, with the companies shown as companies.
 *
 * A native <select> renders as the operating system's own grey list, which on
 * a page like this looks like a form somebody forgot to finish — and it
 * cannot show a logo or a price, so the reader is picking from four ticker
 * codes. This is the same choice with the marks and the prices in it.
 */
function SharePicker({ list, value, onPick }: {
  list: Listing[]; value: string; onPick: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = list.find((s) => s.symbol === value) ?? list[0];
  const boxRef = useRef<HTMLDivElement>(null);

  // Closing on an outside click, because a panel that only closes by choosing
  // something forces a choice on somebody who opened it to look.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!chosen) return null;

  return (
    <div ref={boxRef} className="relative mt-1.5">
      <button
        type="button"
        onClick={() => { haptic(); setOpen((v) => !v); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl border hairline bg-transparent px-3 py-2.5 text-left transition-colors hover:surface"
      >
        <DseLogo logo={chosen.logo} symbol={chosen.symbol} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium leading-tight">{chosen.symbol}</span>
          <span className="block truncate text-[11.5px] text-[var(--muted)]">{chosen.name}</span>
        </span>
        {chosen.price > 0 && (
          <span className="tnum shrink-0 text-[12px] text-[var(--muted)]">
            {Math.round(chosen.price).toLocaleString()} TZS
          </span>
        )}
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div role="listbox"
          className="absolute left-0 right-0 z-30 mt-1.5 max-h-72 overflow-auto rounded-xl border hairline bg-[var(--bg)] p-1 shadow-lg">
          {list.map((s) => (
            <button
              key={s.symbol}
              type="button"
              role="option"
              aria-selected={s.symbol === value}
              onClick={() => { haptic(); onPick(s.symbol); setOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                s.symbol === value ? "surface" : "hover:surface"
              }`}
            >
              <DseLogo logo={s.logo} symbol={s.symbol} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium leading-tight">{s.symbol}</span>
                <span className="block truncate text-[11px] text-[var(--muted)]">{s.name}</span>
              </span>
              {s.price > 0 && (
                <span className="tnum shrink-0 text-[11.5px] text-[var(--muted)]">
                  {Math.round(s.price).toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RecurringBuys({ securities }: { securities: Listing[] }) {
  const { t } = useT();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [open, setOpen] = useState(false);
  /** Whether the section itself is unfolded. Closed until asked for. */
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({
    symbol: securities[0]?.symbol ?? "CRDB",
    amount: "20000",
    cadence: "monthly" as "daily" | "weekly" | "monthly",
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

  /*
   * What the fold has to say for itself.
   *
   * Not "2 plans" — the number people care about is what is leaving their
   * balance and when, so the summary carries the money and the next date.
   */
  const live = (plans ?? []).filter((p) => p.status === "active");
  const active = live.length;
  const perRun = live.reduce((sum, p) => sum + p.amountTzs, 0);
  const soonest = live.map((p) => p.nextRun).sort()[0];
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "numeric", month: "short" });
  const summary = !plans
    ? t("Loading…")
    : active === 0
      ? (plans.length
          ? t("All paused. Tap to see them.")
          : t("Buy the same amount on the same day, without thinking about it."))
      : `${Math.round(perRun).toLocaleString()} TZS · ${t("next")} ${soonest ? shortDate(soonest) : "—"}`;

  return (
    <section className="mt-3 rounded-2xl border hairline p-3.5 sm:p-5">
      {/*
        * Folded away by default.
        *
        * A standing order is set once and then works without being watched,
        * so on the page somebody opens to see their money it was several
        * rows of settled business pushing the balance and the holdings down.
        * The summary is the part worth a glance — how many plans, how much
        * they move — and the rest opens when it is actually wanted.
        */}
      <button
        onClick={() => { haptic(); setShown((v) => !v); }}
        aria-expanded={shown}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="eyebrow block">{t("Automatic investing")}</span>
          <span className="mt-1 block text-[12px] leading-relaxed text-[var(--muted)]">
            {summary}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {active > 0 && (
            <span className="rounded-full surface px-2 py-0.5 text-[11px] tnum">{active}</span>
          )}
          <svg viewBox="0 0 24 24" className={`h-4 w-4 text-[var(--muted)] transition-transform ${shown ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {shown && (
      <div className="mt-3 flex items-center justify-end">
        <button
          onClick={() => { haptic(); setOpen((v) => !v); setErr(null); }}
          className="rounded-full border hairline px-3.5 py-1.5 text-[12px] font-medium hover:surface"
        >
          {open ? t("Close") : t("New plan")}
        </button>
      </div>
      )}

      {shown && open && (
        <div className="mt-3 rounded-2xl surface p-3.5">
          <div>
            <span className="eyebrow">{t("Share")}</span>
            <SharePicker list={securities} value={form.symbol}
              onPick={(symbol) => setForm({ ...form, symbol })} />
          </div>

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
              {[1_000, 5_000, 20_000, 50_000].map((n) => (
                <button key={n} onClick={() => { haptic(); setForm({ ...form, amount: String(n) }); }}
                  className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                    form.amount === String(n) ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                  }`}>
                  {n.toLocaleString()}
                </button>
              ))}
            </div>
          </label>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["daily", "weekly", "monthly"] as const).map((c) => (
              <button key={c}
                onClick={() => { haptic(); setForm({ ...form, cadence: c, dayOf: 1 }); }}
                className={`rounded-xl border px-2 py-2.5 text-[13px] font-medium transition-colors ${
                  form.cadence === c ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                }`}>
                {c === "daily" ? t("Every day") : c === "weekly" ? t("Every week") : t("Every month")}
              </button>
            ))}
          </div>

          {/* Daily has no day to pick. */}
          {form.cadence !== "daily" && (
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
          )}

          {form.cadence === "daily" && (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
              {t("Every morning at 9am, on the days the market trades. The trade fee applies each time, so a small daily amount costs more in fees than the same money once a month.")}
            </p>
          )}

          {err && <p className="mt-2 text-[12px] text-[var(--color-down)]">{err}</p>}

          <button
            onClick={() => { haptic(); void send({ symbol: form.symbol, amountTzs: Number(form.amount), cadence: form.cadence, dayOf: form.dayOf }); }}
            disabled={busy || !(Number(form.amount) >= 1000)}
            className="mt-3 w-full rounded-full bg-[var(--fg)] py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
          >
            {busy ? t("Saving…") : t("Start plan")}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            {t("It spends the shillings already in your account. If the balance is short that day, nothing is bought and we tell you.")}
          </p>
        </div>
      )}

      {shown && plans && plans.length > 0 && (
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
                  {p.lastRunAt && ` · ${t("last")} ${dt(p.lastRunAt)}`}
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
