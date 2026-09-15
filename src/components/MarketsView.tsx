"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { useCrdb, matchesCrdb } from "@/lib/useCrdb";
import { KycPrompt } from "./KycPrompt";
import { useMarkets } from "@/lib/useMarkets";
import { MarketTable } from "./MarketTable";
import { Sparkline } from "./Sparkline";
import { AssetLogo } from "./AssetLogo";
import { Counter } from "./Counter";
import { Reveal } from "./Reveal";
import { compactUsd, ago } from "@/lib/format";

export function MarketsView() {
  const { data, error } = useMarkets();
  /** Shared with the table below, so one search filters both lists. */
  const [query, setQuery] = useState("");
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
    <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-6 sm:px-8 sm:pb-24 sm:pt-12">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="eyebrow">Markets</div>
            <h1 className="display mt-3 text-[clamp(1.8rem,6vw,4.5rem)]">
              Every asset, <span className="contra text-[var(--muted)]">live.</span>
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--muted)]">
              Tokenized equities, priced by Chainlink total-return marks read straight
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

      {/* Above the markets, because browsing is where someone decides to buy
          and being unverified is a limit they should meet before, not after. */}
      <div className="mt-5"><KycPrompt /></div>

      {error && (
        <div className="mt-6 rounded-xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/5 px-4 py-3 text-sm text-[var(--color-down)]">
          {error}
        </div>
      )}

      {/*
        * The local market gets its own card rather than a row in the table.
        *
        * That table is Chainlink marks in dollars; CRDB is a DSE print in
        * shillings against a custody position, and dropping it in as a
        * fourteenth row would have meant a column of dollar prices with one
        * shilling figure in it.
        */}
      {/* Hidden when the search is looking for something else. A listing that
          ignores the filter above it reads as a bug, and CRDB was the one row
          that never disappeared. */}
      {matchesCrdb(query) && (
      <Reveal delay={0.04} className="mt-8">
        <Link
          href="/markets/crdb"
          className="flex items-center gap-4 rounded-2xl border hairline p-4 transition-colors hover:surface sm:p-5"
        >
          <Image src="/crdb.jpg" alt="" width={44} height={44} className="shrink-0 rounded-full object-cover" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">CRDB Bank Plc</span>
              <span className="eyebrow">Dar es Salaam</span>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-[var(--muted)]">
              Buy Tanzanian shares in shillings, settled in nTZS
            </p>
          </div>
          <CrdbTag />
        </Link>
      </Reveal>
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
        <MarketTable onQuery={setQuery} />
      </Reveal>

      <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
        Onchain supply shows share-equivalents: raw token supply multiplied by the current B20
        multiplier. A blank supply means nothing is minted yet; the Chainlink mark is
        still live. Tokenized equities are not available to US persons.
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg)] px-3 py-3 sm:px-5 sm:py-4">
      <div className="eyebrow leading-tight">{label}</div>
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

/** The live CRDB mark, so the card is not just a link to find out. */
function CrdbTag() {
  const d = useCrdb();
  if (!d) return <div className="h-8 w-20 shrink-0 animate-pulse rounded surface" />;
  const up = d.changePct >= 0;
  return (
    <div className="shrink-0 text-right">
      <div className="tnum text-base font-medium">
        {d.price.toLocaleString("en-TZ", { maximumFractionDigits: 0 })}
        <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">TZS</span>
      </div>
      <div className={`tnum text-[11px] ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
        {up ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}%
      </div>
    </div>
  );
}
