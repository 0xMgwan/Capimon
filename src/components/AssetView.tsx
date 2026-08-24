"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AssetMeta } from "@/lib/assets";
import { useMarket, useMarkets } from "@/lib/useMarkets";
import { PriceChart } from "./PriceChart";
import { TradePanel } from "./TradePanel";
import { Sparkline } from "./Sparkline";
import { Reveal } from "./Reveal";
import { compact, compactUsd, usd, short, ago } from "@/lib/format";

export function AssetView({ asset }: { asset: AssetMeta }) {
  const { market, tick } = useMarket(asset.symbol);
  const { data, loading } = useMarkets();
  const [logo, setLogo] = useState<string | null>(null);

  // The B20 contractURI carries the issuer's own logo as an inline data URI.
  useEffect(() => {
    let alive = true;
    fetch(`/api/token?symbol=${asset.symbol}`)
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok && j.image) setLogo(j.image); })
      .catch(() => {});
    return () => { alive = false; };
  }, [asset.symbol]);

  const peers = (data?.markets ?? []).filter((m) => m.symbol !== asset.symbol && m.sector === asset.sector).slice(0, 4);
  const up = (market?.change ?? 0) >= 0;

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-10 sm:px-8">
      <Link href="/markets" className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
        ← All markets
      </Link>

      <Reveal className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-4 sm:gap-6">
          <div className="flex items-center gap-4">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-14 w-14 rounded-2xl object-contain" />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-2xl text-base font-semibold text-white" style={{ background: asset.color }}>
                {asset.ticker.slice(0, 2)}
              </span>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium tracking-[-0.045em] sm:text-4xl">
                  {asset.ticker}
                </h1>
                <span className="tnum rounded-full surface px-2.5 py-1 text-[11px] text-[var(--muted)]">{asset.symbol}</span>
                <span className="rounded-full surface px-2.5 py-1 text-[11px] text-[var(--muted)]">{asset.exchange}</span>
              </div>
              <p className="mt-1 text-[var(--muted)]">{asset.name} · {asset.sector}</p>
            </div>
          </div>

          <div className="w-full text-left sm:w-auto sm:text-right">
            <div className={`tnum text-[2.25rem] font-medium tracking-tight sm:text-5xl ${tick === "up" ? "flash-up" : tick === "down" ? "flash-down" : ""}`}>
              {market ? usd(market.price) : loading ? <span className="inline-block h-11 w-40 animate-pulse rounded surface" /> : "—"}
            </div>
            {market && (
              <div className={`tnum mt-1 text-sm ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {up ? "▲" : "▼"} {Math.abs(market.change).toFixed(2)}% over {market.changeWindowHours}h
                <span className="ml-2 text-[var(--muted)]">· round {ago(market.updatedAt)}</span>
              </div>
            )}
          </div>
        </div>
      </Reveal>

      <p className="mt-6 max-w-2xl font-[family-name:var(--font-serif)] text-lg leading-relaxed text-[var(--muted)]">
        {asset.blurb}
      </p>

      <div className="mt-8 grid gap-5 sm:mt-10 sm:gap-6 lg:grid-cols-[1.7fr_1fr]">
        <Reveal>
          <div className="rounded-3xl border hairline p-4 sm:p-7">
            <PriceChart data={market?.history ?? []} color={up ? "var(--color-up)" : "var(--color-down)"} />
          </div>

          <div className="mt-6 grid gap-px overflow-hidden rounded-3xl bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Onchain supply" value={market && market.supply > 0 ? compact(market.supply, 2) : "0"} sub="share-equivalents" />
            <Stat label="Onchain value" value={market && market.tvl > 0 ? compactUsd(market.tvl) : "$0"} sub="supply × mark" />
            <Stat label="Multiplier" value={market ? `${market.multiplier.toFixed(6)}×` : "—"} sub="corporate actions" />
            <Stat label="Token decimals" value={market ? String(market.decimals) : "—"} sub="B20 precision" />
          </div>

          <Reveal delay={0.06}>
            <div className="mt-6 rounded-3xl border hairline p-6">
              <div className="eyebrow">Onchain references</div>
              <dl className="mt-4 space-y-3 text-sm">
                <RefRow k="B20 token" v={asset.token} />
                <RefRow k="Chainlink feed" v={asset.feed} />
                {market && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[var(--muted)]">Latest round</dt>
                    <dd className="tnum truncate text-xs">{market.roundId}</dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--muted)]">Feed status</dt>
                  <dd className={`tnum text-xs ${market?.stale ? "text-[var(--muted)]" : "text-[var(--color-up)]"}`}>
                    {market ? (market.stale ? "cold — missed a session" : "live · 24/5") : "—"}
                  </dd>
                </div>
              </dl>
              <p className="mt-5 text-[11px] leading-relaxed text-[var(--muted)]">
                One B20 token is not permanently one share. Redemption applies the current multiplier,
                and the Chainlink feed publishes a total-return value — market price × multiplier —
                freezing through corporate actions.
              </p>
            </div>
          </Reveal>
        </Reveal>

        <div className="lg:sticky lg:top-32 lg:self-start">
          <Reveal delay={0.08}>
            <TradePanel asset={asset} market={market} />
          </Reveal>

          {peers.length > 0 && (
            <Reveal delay={0.14}>
              <div className="mt-6 rounded-3xl border hairline p-5">
                <div className="eyebrow">Also in {asset.sector}</div>
                <div className="mt-4 space-y-3">
                  {peers.map((p) => (
                    <Link key={p.symbol} href={`/markets/${p.ticker.toLowerCase()}`} className="flex items-center gap-3 transition-opacity hover:opacity-70">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white" style={{ background: p.color }}>
                        {p.ticker.slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-medium">{p.ticker}</span>
                      <Sparkline data={p.history.slice(-24)} color={p.change >= 0 ? "var(--color-up)" : "var(--color-down)"} width={48} height={20} fill={false} />
                      <span className={`tnum shrink-0 text-xs ${p.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                        {p.change >= 0 ? "+" : ""}{p.change.toFixed(2)}%
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </Reveal>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-[var(--bg)] p-5">
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-2 text-xl font-medium">{value}</div>
      <div className="mt-1 text-[11px] text-[var(--muted)]">{sub}</div>
    </div>
  );
}

function RefRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd>
        <a href={`https://basescan.org/address/${v}`} target="_blank" rel="noreferrer" className="tnum text-xs transition-colors hover:text-[var(--color-accent)]">
          {short(v)} ↗
        </a>
      </dd>
    </div>
  );
}
