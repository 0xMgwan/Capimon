"use client";

import { useState } from "react";
import { useHistory, activityCsv, type Activity } from "@/lib/useHistory";
import { AssetLogo } from "./AssetLogo";
import { Reveal } from "./Reveal";
import { usd, short } from "@/lib/format";

const KIND_LABEL: Record<Activity["kind"], string> = {
  buy: "Buy", sell: "Sell", receive: "Received", send: "Sent",
};

export function CostBasis({ address }: { address: string }) {
  const { data, loading, error } = useHistory(address);
  const [showAll, setShowAll] = useState(false);

  const download = () => {
    if (!data) return;
    const blob = new Blob([activityCsv(data.activity)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `capx-activity-${address.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="mt-10 rounded-2xl border border-dashed hairline p-5 text-sm text-[var(--muted)]">
        Cost basis unavailable — {error}. Positions above are unaffected.
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mt-10 rounded-3xl border hairline p-6">
        <div className="eyebrow">Cost basis</div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Rebuilding your history from onchain transfers…
        </p>
        <div className="mt-4 grid gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl surface" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  // A failed rebuild must not look like an empty history. Only stay silent when
  // the scan actually completed and genuinely found nothing.
  if (!data.positions.length) {
    if (data.complete) return null;
    return (
      <div className="mt-10 rounded-2xl border border-[#b45309]/40 bg-[#b45309]/[0.06] p-5">
        <div className="text-sm font-medium text-[#b45309]">Could not rebuild your cost basis</div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          {data.missedRanges} of {data.totalRanges} block ranges could not be read, so no history is
          shown rather than a wrong one. This is RPC rate limiting — try again shortly, or point the
          app at a dedicated RPC. Your positions above are read directly and are unaffected.
        </p>
      </div>
    );
  }

  const t = data.totals;
  const shown = showAll ? data.activity : data.activity.slice(0, 8);

  return (
    <Reveal delay={0.06} className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Cost basis &amp; performance</div>
          <h2 className="display mt-2 text-[clamp(1.35rem,3.6vw,2.4rem)]">What you actually paid.</h2>
        </div>
        <button
          onClick={download}
          className="rounded-full border hairline px-4 py-2.5 text-sm transition-colors hover:surface"
        >
          Export CSV
        </button>
      </div>

      {!data.complete && (
        <div className="mt-5 rounded-2xl border border-[#b45309]/40 bg-[#b45309]/[0.06] px-4 py-3 text-xs leading-relaxed text-[#b45309]">
          Incomplete history — {data.missedRanges} of {data.totalRanges} block ranges could not be
          read, so these figures understate your activity. This is usually RPC rate limiting;
          refresh in a moment, or point the app at a dedicated RPC.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-4">
        <Cell label="Cost basis" value={usd(t.costBasis)} />
        <Cell label="Market value" value={usd(t.marketValue)} />
        <Cell
          label="Unrealised"
          value={<span className={t.unrealised >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
            {t.unrealised >= 0 ? "+" : ""}{usd(t.unrealised)}
          </span>}
        />
        <Cell
          label="Realised"
          value={<span className={t.realised >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
            {t.realised >= 0 ? "+" : ""}{usd(t.realised)}
          </span>}
        />
      </div>

      <div className="mt-4 grid gap-2">
        {data.positions.map((p) => (
          <div key={p.symbol} className="flex items-center gap-3 rounded-2xl border hairline p-4">
            <AssetLogo logo={p.logo} ticker={p.ticker} color={p.color} size={36} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{p.ticker}</div>
              <div className="tnum text-[11px] text-[var(--muted)]">
                avg {p.avgCost ? usd(p.avgCost) : "—"} · mark {usd(p.price)}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="tnum text-sm font-medium">{usd(p.marketValue)}</div>
              <div className={`tnum text-[11px] ${p.unrealised >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {p.unrealised >= 0 ? "+" : ""}{usd(p.unrealised)}
                {p.unrealisedPct !== null && ` · ${p.unrealisedPct >= 0 ? "+" : ""}${p.unrealisedPct.toFixed(2)}%`}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border hairline">
        <div className="border-b hairline px-4 py-3">
          <span className="eyebrow">Activity · {data.activity.length} events</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {shown.map((a) => (
            <a
              key={`${a.tx}-${a.ticker}-${a.ts}-${a.qty}`}
              href={`https://basescan.org/tx/${a.tx}`}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:surface"
            >
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                a.kind === "buy" || a.kind === "receive"
                  ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
                  : "bg-[var(--color-down)]/10 text-[var(--color-down)]"
              }`}>
                {KIND_LABEL[a.kind]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{a.ticker}</span>
                <span className="tnum block text-[11px] text-[var(--muted)]">
                  {new Date(a.ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {" · "}{short(a.tx)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="tnum block text-sm">{a.qty.toFixed(6)}</span>
                <span className="tnum block text-[11px] text-[var(--muted)]">
                  {usd(a.value)} · {a.priceSource === "fill" ? "actual fill" : "marked"}
                </span>
              </span>
            </a>
          ))}
        </div>
        {data.activity.length > 8 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="w-full border-t hairline py-3 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            {showAll ? "Show less" : `Show all ${data.activity.length} events`}
          </button>
        )}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-[var(--muted)]">
        Average-cost accounting. Swaps are priced at the USDC actually moved in the same transaction
        (&ldquo;actual fill&rdquo;); plain transfers in or out have no counter-leg, so they are marked
        at the oracle round nearest the block. Figures are a working aid, not tax advice —
        {data.complete ? " history covers every B20 transfer to date." : ""}
      </p>
    </Reveal>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg)] px-3 py-3 sm:px-5 sm:py-4">
      <div className="eyebrow truncate">{label}</div>
      <div className="tnum mt-1.5 text-base font-medium sm:text-lg">{value}</div>
    </div>
  );
}
