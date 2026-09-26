"use client";

import Link from "next/link";
import { Comments } from "./Comments";
import { TradeFeed } from "./TradeFeed";
import { useEffect, useState } from "react";
import type { AssetMeta } from "@/lib/assets";
import { useMarket, useMarkets } from "@/lib/useMarkets";
import { PriceChart } from "./PriceChart";
import { TradePanel } from "./TradePanel";
import { CustodialTradePanel } from "./CustodialTradePanel";
import { PanelBoundary } from "./PanelBoundary";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useAccount } from "wagmi";
import { Sparkline } from "./Sparkline";
import { AssetLogo } from "./AssetLogo";
import { Reveal } from "./Reveal";
import { compact, compactUsd, usd, short, ago } from "@/lib/format";
import { useT } from "@/lib/i18n";

export function AssetView({ asset }: { asset: AssetMeta }) {
  const { t } = useT();
  const { market, tick } = useMarket(asset.symbol);
  const { account } = useCapimonAccount();
  const { isConnected } = useAccount();
  // A connected wallet always wins: if someone holds their own keys, we never
  // quietly trade on their behalf instead.
  const custodial = !isConnected && !!account;
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
    <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-3 sm:px-8 sm:pt-8">
      <Link href="/markets" className="text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
        ← {t("Markets")}
      </Link>

      {/*
        * Compact, and in the order someone uses it.
        *
        * On a phone the ticket used to start 1,600px down, below four stat
        * cards stacked one per row and a box of contract addresses. The header
        * is now one row with the price, the blurb two lines, and the page runs
        * chart → ticket → details, with the addresses folded away. From lg the
        * ticket stays pinned beside the chart.
        */}
      <Reveal className="mt-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <AssetLogo logo={market?.logo ?? logo} ticker={asset.ticker} color={asset.color} size={44} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.045em] sm:text-4xl">
                  {asset.ticker}
                </h1>
                <span className="rounded-full surface px-2 py-0.5 text-[10px] text-[var(--muted)]">{asset.exchange}</span>
              </div>
              <p className="truncate text-[12.5px] text-[var(--muted)] sm:text-sm">{asset.name} · {asset.sector}</p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className={`tnum text-[1.6rem] font-medium leading-none tracking-tight sm:text-5xl ${tick === "up" ? "flash-up" : tick === "down" ? "flash-down" : ""}`}>
              {market ? usd(market.price) : loading ? <span className="inline-block h-7 w-24 animate-pulse rounded surface" /> : "—"}
            </div>
            {market && (
              <div className={`tnum mt-1 text-[12px] ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {up ? "▲" : "▼"} {Math.abs(market.change).toFixed(2)}% · {market.changeWindowHours}h
              </div>
            )}
          </div>
        </div>
      </Reveal>

      <p className="mt-2 line-clamp-2 max-w-2xl text-[13.5px] leading-snug text-[var(--muted)] sm:mt-4 sm:text-lg sm:leading-relaxed">
        {asset.blurb}
      </p>

      <div className="mt-3 grid gap-3 sm:mt-8 sm:gap-6 lg:grid-cols-[1.7fr_1fr]">
        <Reveal className="lg:col-start-1 lg:row-start-1">
          <div className="rounded-2xl border hairline p-3 sm:rounded-3xl sm:p-7">
            <PriceChart data={market?.history ?? []} color={up ? "var(--color-up)" : "var(--color-down)"} />
          </div>
        </Reveal>

        <div id="ticket" className="scroll-mt-24 lg:sticky lg:top-32 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <Reveal delay={0.08}>
            <PanelBoundary label={t("Order ticket")}>
              {custodial
                ? <CustodialTradePanel asset={asset} market={market} />
                : <TradePanel asset={asset} market={market} />}
            </PanelBoundary>
          </Reveal>
        </div>

        <div className="lg:col-start-1">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] lg:grid-cols-4">
            <Stat label={t("Onchain supply")} value={market && market.supply > 0 ? compact(market.supply, 2) : "0"} sub="share-equivalents" />
            <Stat label={t("Onchain value")} value={market && market.tvl > 0 ? compactUsd(market.tvl) : "$0"} sub="supply × mark" />
            <Stat label={t("Multiplier")} value={market ? `${market.multiplier.toFixed(4)}×` : "—"} sub="corporate actions" />
            <Stat label={t("Token decimals")} value={market ? String(market.decimals) : "—"} sub={t("B20 precision")} />
          </div>

          {peers.length > 0 && (
            <div className="mt-3 rounded-2xl border hairline px-3.5 py-3">
              <div className="eyebrow">Also in {asset.sector}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {peers.map((p) => (
                  <Link key={p.symbol} href={`/markets/${p.ticker.toLowerCase()}`} className="flex items-center gap-2.5 transition-opacity hover:opacity-70">
                    <AssetLogo logo={p.logo} ticker={p.ticker} color={p.color} size={26} />
                    <span className="min-w-0 flex-1 text-[13px] font-medium">{p.ticker}</span>
                    <Sparkline data={p.history.slice(-24)} color={p.change >= 0 ? "var(--color-up)" : "var(--color-down)"} width={44} height={18} fill={false} />
                    <span className={`tnum shrink-0 text-xs ${p.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                      {p.change >= 0 ? "+" : ""}{p.change.toFixed(2)}%
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* The addresses are for checking, not for reading every visit. */}
          <details className="group mt-3 rounded-2xl border hairline px-3.5 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-medium">
              {t("Contract details")}
              <span className="text-[var(--muted)] transition-transform group-open:rotate-45">+</span>
            </summary>
            <dl className="mt-3 space-y-2.5 text-sm">
              <RefRow k="B20 token" v={asset.token} />
              <RefRow k="Chainlink feed" v={asset.feed} />
              {market && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--muted)]">{t("Latest round")}</dt>
                  <dd className="tnum truncate text-xs">{market.roundId}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("Feed status")}</dt>
                <dd className={`tnum text-xs ${market?.stale ? "text-[var(--muted)]" : "text-[var(--color-up)]"}`}>
                  {market ? (market.stale ? "cold — missed a session" : `live · ${ago(market.updatedAt)}`) : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
              One token is not permanently one share: splits and dividends adjust a multiplier,
              which is applied to every share count shown.
            </p>
          </details>
        </div>
      </div>

      {/*
        On a phone the ticket sits below the chart and the peers list, so buying
        meant scrolling past everything to find it. A fixed bar keeps the action
        one tap away wherever you are on the page; above lg the ticket is
        already pinned beside the chart, so it would only be clutter.
      */}
      {/* Below everything, including the peers: somebody who came to buy
          should reach the ticket long before they reach an argument. */}
      <div className="mt-3"><TradeFeed symbol={asset.symbol} /></div>
      <Comments symbol={asset.symbol} />

      <div className="safe-b fixed inset-x-0 bottom-[4.25rem] z-40 px-4 lg:hidden">
        <a
          href="#ticket"
          className="flex items-center justify-between gap-3 rounded-full bg-[var(--fg)] px-5 py-3.5 text-sm font-medium text-[var(--bg)] shadow-lg shadow-black/20 transition-transform active:scale-95"
        >
          <span>Trade {asset.ticker}</span>
          <span className="tnum opacity-70">{market ? usd(market.price) : "—"}</span>
        </a>
      </div>

    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-[var(--bg)] px-3 py-2.5 sm:p-4">
      <div className="eyebrow truncate">{label}</div>
      <div className="tnum mt-1 text-[15px] font-medium sm:text-lg">{value}</div>
      <div className="mt-0.5 truncate text-[10.5px] text-[var(--muted)]">{sub}</div>
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
