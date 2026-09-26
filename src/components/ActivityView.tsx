"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { pollWhileVisible } from "@/lib/usePoll";
import { useMarkets } from "@/lib/useMarkets";
import { useDse, dseLogoOf } from "@/lib/useDse";
import { AssetLogo } from "./AssetLogo";
import { NtzsIcon } from "./icons/Ntzs";
import { UsdcIcon } from "./icons/Usdc";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

/**
 * Every movement of one customer's money, with the receipt underneath.
 *
 * The bell says what just happened and forgets it; the portfolio says what
 * you hold now. Neither answers "what did I pay for that", "did the deposit I
 * made on Tuesday arrive", or "what do I quote at the bank about the
 * withdrawal that failed" — and those are the questions people actually bring
 * to a broker.
 *
 * Collapsed, a row is a sentence: what, how much, when, and whether it
 * worked. Opened, it is a receipt — every reference the upstream system knows
 * it by, the price it filled at, the fee, and the verbatim reason if it
 * failed. Nothing is rounded away and nothing is computed for display; a
 * figure that is not recorded is simply not shown.
 *
 * Filters are a row of counts rather than a dropdown, because the useful
 * question is nearly always "just the deposits" or "only what went wrong",
 * and both should be one tap with the answer already on screen.
 */

type Item = {
  id: string;
  kind: "buy" | "sell" | "deposit" | "withdrawal" | "self-buy" | "self-sell" | "adjustment";
  status: "pending" | "settled" | "failed";
  at: string;
  settledAt: string | null;
  asset: string | null;
  qty: number | null;
  amount: number | null;
  currency: "TZS" | "USDC" | null;
  price: number | null;
  fee: number | null;
  error: string | null;
  refs: { label: string; value: string; href?: string }[];
  note: string | null;
};

type Filter = "all" | "trades" | "money" | "issues";

const MATCH: Record<Filter, (i: Item) => boolean> = {
  all: () => true,
  trades: (i) => ["buy", "sell", "self-buy", "self-sell"].includes(i.kind),
  money: (i) => ["deposit", "withdrawal", "adjustment"].includes(i.kind),
  issues: (i) => i.status !== "settled",
};

const qtyFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 8 });

function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ActivityView() {
  const { t } = useT();
  const { account, enabled } = useCapimonAccount();
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!account) { setItems([]); return; }
    let alive = true;
    const load = () => {
      fetch("/api/account/activity", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (alive) setItems(j.ok ? j.items : []); })
        .catch(() => { if (alive) setItems([]); });
    };
    load();
    // A settling deposit changes status without anybody doing anything, so
    // the page watches — but slowly, and only while it is being looked at.
    const stop = pollWhileVisible(load, 30_000);
    return () => { alive = false; stop(); };
  }, [account]);

  if (!enabled) return null;

  if (!account) {
    return (
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-8 sm:pt-10">
        <h1 className="display text-[clamp(1.4rem,4vw,2.2rem)]">{t("Your activity.")}</h1>
        <p className="mt-3 rounded-2xl surface px-4 py-3 text-[13px] leading-relaxed text-[var(--muted)]">
          {t("Sign in to see every deposit, trade and withdrawal on your account, with the receipt for each one.")}
        </p>
      </div>
    );
  }

  const shown = (items ?? []).filter(MATCH[filter]);
  const counts: Record<Filter, number> = {
    all: (items ?? []).length,
    trades: (items ?? []).filter(MATCH.trades).length,
    money: (items ?? []).filter(MATCH.money).length,
    issues: (items ?? []).filter(MATCH.issues).length,
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-5 sm:px-8 sm:pt-9">
      <h1 className="display text-[clamp(1.4rem,4vw,2.2rem)]">{t("Your activity.")}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
        {t("Everything that has moved, newest first. Tap a row for the receipt.")}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(["all", "trades", "money", "issues"] as const).map((f) => (
          <button
            key={f}
            onClick={() => { haptic(); setFilter(f); }}
            disabled={f !== "all" && counts[f] === 0}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-35 ${
              filter === f ? "border-transparent bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
            }`}
          >
            {t(f === "all" ? "Everything" : f === "trades" ? "Trades"
              : f === "money" ? "Money in and out" : "Needs attention")}
            {counts[f] > 0 && <span className="tnum ml-1.5 opacity-60">{counts[f]}</span>}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="mt-4 grid gap-1.5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl surface" />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="mt-5 rounded-2xl border hairline px-4 py-8 text-center text-sm text-[var(--muted)]">
          {filter === "all"
            ? t("Nothing has moved yet. Your first deposit will show up here.")
            : t("Nothing here.")}
        </p>
      ) : (
        <div className="mt-4 grid gap-1.5">
          {shown.map((i) => (
            <Row key={i.id} item={i} open={open === i.id}
              onToggle={() => { haptic(); setOpen(open === i.id ? null : i.id); }} t={t} />
          ))}
        </div>
      )}

      {/*
        Said plainly rather than left as a gap somebody has to notice.
        A customer looking for a dividend entry needs to know it is absent by
        design and not missing by accident — the shares do not carry one, and
        a US token's dividend arrives as a change in the multiplier rather
        than as an event on an account.
      */}
      <p className="mt-6 text-[11px] leading-relaxed text-[var(--muted)]">
        {t("Tanzanian shares carry no dividend entitlement, so none appears here. US shares reflect dividends through the token's on-chain multiplier, which changes what a holding is worth rather than paying into an account.")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ row -- */

const TONE: Record<Item["status"], string> = {
  settled: "text-[var(--muted)]",
  pending: "text-[#b45309]",
  failed: "text-[var(--color-down)]",
};

function Row({ item, open, onToggle, t }: {
  item: Item; open: boolean; onToggle: () => void; t: (s: string) => string;
}) {
  const { data } = useMarkets();
  const dse = useDse();

  const money = (n: number | null, ccy: Item["currency"]) =>
    n === null ? "—"
    : ccy === "USDC" ? `$${n.toFixed(2)}`
    : `${Math.round(n).toLocaleString()} TZS`;

  const title =
    item.kind === "deposit" ? t("Deposit")
    : item.kind === "withdrawal" ? t("Withdrawal")
    : item.kind === "adjustment" ? t("Adjustment")
    : item.kind === "self-buy" ? `${t("Bought")} ${item.asset} → ${t("wallet")}`
    : item.kind === "self-sell" ? `${t("Sold")} ${item.asset} ${t("from wallet")}`
    : `${item.kind === "buy" ? t("Bought") : t("Sold")} ${item.asset}`;

  const m = item.asset ? data?.markets.find((x) => x.symbol === item.asset || x.ticker === item.asset) : null;
  const dseLogo = item.asset ? dseLogoOf(dse, item.asset) : undefined;

  return (
    <div className={`overflow-hidden rounded-2xl border ${
      item.status === "failed" ? "border-[var(--color-down)]/35" : "hairline"}`}>
      <button onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:surface">
        {/* The company where there is one, a mark for money where there is not. */}
        {item.asset ? (
          <AssetLogo
            logo={dseLogo !== undefined ? dseLogo ?? null : m?.logo ?? null}
            ticker={m?.ticker ?? item.asset}
            color={dseLogo !== undefined ? "#0B7D3E" : m?.color ?? "var(--color-accent)"}
            size={34}
          />
        ) : (
          <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full surface">
            {item.currency === "USDC" ? <UsdcIcon className="h-5 w-5" /> : <NtzsIcon className="h-5 w-5 rounded-full" />}
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{title}</span>
          <span className={`block truncate text-[11px] ${TONE[item.status]}`}>
            {when(item.at)}
            {item.status !== "settled" && ` · ${t(item.status === "pending" ? "Pending" : "Failed")}`}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="tnum block text-[13.5px]">{money(item.amount, item.currency)}</span>
          {item.qty !== null && (
            <span className="tnum block text-[11px] text-[var(--muted)]">
              {qtyFmt(item.qty)} {item.asset}
            </span>
          )}
        </span>

        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="border-t hairline px-3.5 py-3 text-[12px]">
          {item.note && <p className="mb-2 leading-relaxed text-[var(--muted)]">{item.note}</p>}
          {item.error && (
            <p className="mb-2 rounded-xl border border-[var(--color-down)]/35 bg-[var(--color-down)]/[0.06] px-3 py-2 leading-relaxed text-[var(--color-down)]">
              {item.error}
            </p>
          )}

          <dl className="grid gap-1">
            <Detail label={t("Started")} value={new Date(item.at).toLocaleString("en-GB", {
              day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} />
            {item.settledAt && item.settledAt !== item.at && (
              <Detail label={t("Settled")} value={new Date(item.settledAt).toLocaleString("en-GB", {
                day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} />
            )}
            {item.price !== null && item.price > 0 && (
              <Detail label={t("Price")} value={
                item.kind === "self-buy" || item.kind === "self-sell"
                  ? `${Math.round(item.price).toLocaleString()} TZS`
                  : money(item.price, item.currency)} />
            )}
            {item.fee !== null && item.fee > 0 && (
              <Detail label={t("Fee")} value={money(item.fee, item.currency)} />
            )}
            {item.refs.map((r) => (
              <Detail key={r.label + r.value} label={t(r.label)} value={r.value} href={r.href} mono />
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, href, mono }: {
  label: string; value: string; href?: string; mono?: boolean;
}) {
  const text = mono && value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[var(--muted)]">{label}</dt>
      <dd className={`min-w-0 truncate text-right ${mono ? "tnum" : ""}`}>
        {href ? (
          <Link href={href} target="_blank" rel="noreferrer"
            className="underline underline-offset-2 hover:text-[var(--color-accent)]">
            {text}
          </Link>
        ) : text}
      </dd>
    </div>
  );
}
