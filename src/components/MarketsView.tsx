"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMarkets } from "@/lib/useMarkets";
import { MarketTable } from "./MarketTable";
import { Sparkline } from "./Sparkline";
import { AssetLogo } from "./AssetLogo";
import { Counter } from "./Counter";
import { Reveal } from "./Reveal";
import { compactUsd, ago } from "@/lib/format";

export function MarketsView() {
  const { data, error } = useMarkets();
  const markets = useMemo(() => data?.markets ?? [], [data]);

  const { gainers, losers, sectors } = useMemo(() => {
    const sorted = [...markets].sort((a, b) => b.change - a.change);
    const bySector = new Map<string, { tvl: number; n: number; change: number }>();
    for (const m of markets) {
      const s = bySector.get(m.sector) ?? { tvl: 0, n: 0, change: 0 };
      bySector.set(m.sector, { tvl: s.tvl + m.tvl, n: s.n + 1, change: s.change + m.change });
    }
    return {
      gainers: sorted.slice(0, 3),
      losers: sorted.slice(-3).reverse(),
      sectors: [...bySector.entries()]
        .map(([name, v]) => ({ name, tvl: v.tvl, n: v.n, change: v.change / v.n }))
        .sort((a, b) => b.tvl - a.tvl),
    };
  }, [markets]);

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-12 sm:px-8">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="eyebrow">Markets</div>
            <h1 className="display mt-3 text-[clamp(2.2rem,6vw,4.5rem)]">
              Every asset, <span className="font-[family-name:var(--font-serif)] font-light italic text-[var(--muted)]">live.</span>
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--muted)]">
              B20 tokenized equities on Base. Prices are Chainlink total-return marks read straight
              from the chain; supply and value are onchain reads, not estimates.
            </p>
          </div>

          <div className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-2xl bg-[var(--border)] lg:w-auto">
            <Cell label="Onchain value" value={<Counter value={data?.totals.tvl ?? 0} format={compactUsd} />} />
            <Cell label="Assets" value={<Counter value={markets.length} format={(n) => Math.round(n).toString()} />} />
            <Cell label="Snapshot" value={data ? ago(data.asOf) : "—"} />
          </div>
        </div>
      </Reveal>

      {error && (
        <div className="mt-6 rounded-xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/5 px-4 py-3 text-sm text-[var(--color-down)]">
          {error}
        </div>
      )}

      <Reveal delay={0.06} className="mt-10">
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
          <MoverCard title="Top movers" rows={gainers} />
          <MoverCard title="Biggest drawdowns" rows={losers} />
          <div className="rounded-2xl border hairline p-5">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">By sector</span>
              <span className="eyebrow">avg move</span>
            </div>
            <div className="mt-4 space-y-3">
              {sectors.length === 0 && <div className="h-24 animate-pulse rounded surface" />}
              {sectors.map((s) => (
                <div key={s.name}>
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate">
                      {s.name} <span className="tnum text-[var(--muted)]">· {s.n}</span>
                    </span>
                    <span className={`tnum shrink-0 ${s.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                      {s.change >= 0 ? "+" : ""}{s.change.toFixed(2)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full surface">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-700"
                      style={{ width: `${Math.max(3, (s.n / Math.max(1, markets.length)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.1} className="mt-12">
        <MarketTable />
      </Reveal>

      <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
        Onchain supply shows share-equivalents — raw token supply multiplied by the current B20
        multiplier. A supply of “—” means no tokens are minted on Base yet; the Chainlink mark is
        still live. Tokenized equities are not available to US persons.
      </p>
    </div>
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

function MoverCard({ title, rows }: { title: string; rows: ReturnType<typeof useMarkets>["data"] extends null ? never[] : NonNullable<ReturnType<typeof useMarkets>["data"]>["markets"] }) {
  return (
    <div className="rounded-2xl border hairline p-5">
      <div className="eyebrow">{title}</div>
      <div className="mt-4 space-y-3">
        {rows.length === 0 && <div className="h-24 animate-pulse rounded surface" />}
        {rows.map((m) => (
          <Link key={m.symbol} href={`/markets/${m.ticker.toLowerCase()}`} className="flex items-center gap-3 transition-opacity hover:opacity-70">
            <AssetLogo logo={m.logo} ticker={m.ticker} color={m.color} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{m.ticker}</span>
              <span className="tnum block text-[11px] text-[var(--muted)]">${m.price.toFixed(2)}</span>
            </span>
            <Sparkline data={m.history.slice(-30)} color={m.change >= 0 ? "var(--color-up)" : "var(--color-down)"} width={54} height={22} fill={false} />
            <span className={`tnum shrink-0 text-sm ${m.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
              {m.change >= 0 ? "+" : ""}{m.change.toFixed(2)}%
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
