"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { useMarkets } from "@/lib/useMarkets";
import { WalletButton } from "./WalletButton";
import { Sparkline } from "./Sparkline";
import { AssetLogo } from "./AssetLogo";
import { Counter } from "./Counter";
import { Reveal } from "./Reveal";
import { UsdcIcon } from "./icons/Usdc";
import { CostBasis } from "./CostBasis";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { CustodialPortfolio } from "./CustodialPortfolio";
import { usd, compactUsd, short } from "@/lib/format";

type Position = {
  symbol: string; ticker: string; name: string; color: string; token: string;
  qty: number; price: number; change: number; value: number;
};
type Portfolio = { ok: boolean; positions: Position[]; equity: number; cash: number; total: number; gas: number; error?: string };

export function PortfolioView() {
  const { address: connected, isConnected } = useAccount();
  const { account: custodial } = useCapimonAccount();
  const params = useSearchParams();
  // ?address=0x… opens any wallet read-only, without connecting one.
  const watched = params.get("address");
  const readOnly = !!watched && isAddress(watched) && watched.toLowerCase() !== connected?.toLowerCase();
  const address = readOnly ? (watched as `0x${string}`) : connected;
  const { data: markets } = useMarkets();
  const [fetched, setFetched] = useState<{ address: string; pf: Portfolio } | null>(null);
  // Tie the result to the wallet it came from, so switching wallets shows a
  // loading state rather than the previous wallet's book.
  const pf = fetched && fetched.address === address ? fetched.pf : null;
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/portfolio?address=${address}`, { cache: "no-store" });
        const j: Portfolio = await r.json();
        if (!alive) return;
        if (!j.ok) throw new Error(j.error ?? "could not read Base");
        setFetched({ address, pf: j }); setErr(null);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "could not read Base");
      } finally {
        if (alive) setLoading(false);
      }
    };
    // Deferred so the first read does not set state inside the effect body.
    const first = setTimeout(load, 0);
    const id = setInterval(load, 20_000);
    return () => { alive = false; clearTimeout(first); clearInterval(id); };
  }, [address]);

  // Signed into a custodial account and no wallet connected: that book is the
  // one they mean.
  if (!isConnected && !readOnly && custodial) return <CustodialPortfolio />;

  if (!isConnected && !readOnly) {
    return (
      <div className="mx-auto max-w-[1400px] px-5 py-10 sm:px-8 sm:py-16 lg:py-24">
        <div className="mx-auto max-w-lg rounded-3xl border hairline p-10 text-center">
          <div className="eyebrow">Portfolio</div>
          <h1 className="display mt-4 text-4xl">Read your positions off Base.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">
            CAPX holds nothing. Connect a wallet and we query the B20 contracts on Base directly,
            then mark every balance against the live Chainlink feed.
          </p>
          <div className="mt-7 flex justify-center [&>div>button]:px-8 [&>div>button]:py-3.5">
            <WalletButton />
          </div>
        </div>
      </div>
    );
  }

  const positions = pf?.positions ?? [];
  const dayPnl = positions.reduce((s, p) => s + (p.value * p.change) / 100, 0);

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-12 sm:px-8">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="eyebrow">Portfolio</div>
            <h1 className="display mt-3 text-[clamp(2rem,5vw,3.6rem)]">Your onchain book.</h1>
            <p className="tnum mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
              <a href={`https://basescan.org/address/${address}`} target="_blank" rel="noreferrer" className="hover:text-[var(--fg)]">
                {short(address)} ↗
              </a>
              <span>· Base mainnet</span>
              {readOnly && <span className="rounded-full surface px-2 py-0.5 text-[11px]">watching · read-only</span>}
              {loading && <span className="opacity-60">syncing…</span>}
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-4 lg:w-auto">
            <Cell label="Total value" value={<Counter value={pf?.total ?? 0} format={(n) => usd(n)} />} />
            <Cell label="Equities" value={<Counter value={pf?.equity ?? 0} format={(n) => usd(n)} />} />
            <Cell
              label={<span className="inline-flex items-center gap-1.5"><UsdcIcon className="h-3.5 w-3.5" />USDC</span>}
              value={<Counter value={pf?.cash ?? 0} format={(n) => usd(n)} />}
            />
            <Cell
              label="Session P&L"
              value={<span className={dayPnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>{dayPnl >= 0 ? "+" : ""}{usd(dayPnl)}</span>}
            />
          </div>
        </div>
      </Reveal>

      {err && (
        <div className="mt-6 rounded-xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/5 px-4 py-3 text-sm text-[var(--color-down)]">
          {err}
        </div>
      )}

      <Reveal delay={0.06} className="mt-10">
        {positions.length === 0 ? (
          <div className="rounded-3xl border border-dashed hairline p-12 text-center">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.04em]">No B20 positions yet</h2>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
              This wallet holds none of the {markets?.totals.assets ?? 13} tokenized equities CAPX tracks
              on Base.{" "}
              {pf && pf.cash > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  It does hold {usd(pf.cash)} <UsdcIcon className="h-3.5 w-3.5" /> USDC, ready to deploy.
                </span>
              )}
            </p>
            <Link href="/markets" className="mt-6 inline-block rounded-full bg-[var(--fg)] px-6 py-3 text-sm font-medium text-[var(--bg)]">
              Browse markets →
            </Link>
          </div>
        ) : (
          <>
          {/* Phones get cards; the positions table is wider than a phone. */}
          <div className="grid gap-2 md:hidden">
            {positions.map((p) => {
              const m = markets?.markets.find((x) => x.symbol === p.symbol);
              const weight = pf && pf.total > 0 ? (p.value / pf.total) * 100 : 0;
              return (
                <Link key={p.symbol} href={`/markets/${p.ticker.toLowerCase()}`}
                  className="block rounded-2xl border hairline p-4 transition-colors active:surface">
                  <div className="flex items-center gap-3">
                    <AssetLogo logo={markets?.markets.find((x) => x.symbol === p.symbol)?.logo} ticker={p.ticker} color={p.color} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{p.ticker}</span>
                      <span className="tnum block truncate text-xs text-[var(--muted)]">
                        {p.qty.toFixed(6)} @ {usd(p.price)}
                      </span>
                    </span>
                    <Sparkline data={(m?.history ?? []).slice(-30)}
                      color={p.change >= 0 ? "var(--color-up)" : "var(--color-down)"} width={52} height={24} />
                    <span className="shrink-0 text-right">
                      <span className="tnum block text-[15px] font-medium">{usd(p.value)}</span>
                      <span className={`tnum block text-xs ${p.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                        {p.change >= 0 ? "+" : ""}{p.change.toFixed(2)}%
                      </span>
                    </span>
                  </div>
                  <div className="tnum mt-3 flex justify-between border-t hairline pt-2.5 text-[11px] text-[var(--muted)]">
                    <span>{weight.toFixed(1)}% of book</span>
                    <span>{p.name}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="scroll-thin hidden overflow-x-auto rounded-2xl border hairline md:block">
            <table className="w-full min-w-[720px] border-collapse">
              <thead className="border-b hairline">
                <tr>
                  {["Position", "Quantity", "Mark", "Change", "Trend", "Value", "Weight"].map((h, i) => (
                    <th key={h} className={`px-3 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] ${i === 0 ? "text-left" : "text-right"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const m = markets?.markets.find((x) => x.symbol === p.symbol);
                  const weight = pf && pf.total > 0 ? (p.value / pf.total) * 100 : 0;
                  return (
                    <tr key={p.symbol} className="border-b hairline transition-colors last:border-0 hover:surface">
                      <td className="px-3 py-3.5">
                        <Link href={`/markets/${p.ticker.toLowerCase()}`} className="flex items-center gap-3">
                          <AssetLogo logo={m?.logo} ticker={p.ticker} color={p.color} size={36} />
                          <span>
                            <span className="block text-sm font-medium">{p.ticker}</span>
                            <span className="block text-xs text-[var(--muted)]">{p.name}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="tnum px-3 py-3.5 text-right text-sm">{p.qty.toFixed(6)}</td>
                      <td className="tnum px-3 py-3.5 text-right text-sm">{usd(p.price)}</td>
                      <td className={`tnum px-3 py-3.5 text-right text-sm ${p.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                        {p.change >= 0 ? "+" : ""}{p.change.toFixed(2)}%
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex justify-end">
                          <Sparkline data={(m?.history ?? []).slice(-30)} color={p.change >= 0 ? "var(--color-up)" : "var(--color-down)"} width={80} height={26} />
                        </div>
                      </td>
                      <td className="tnum px-3 py-3.5 text-right text-sm font-medium">{usd(p.value)}</td>
                      <td className="tnum px-3 py-3.5 text-right text-sm text-[var(--muted)]">{weight.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Reveal>

      {address && positions.length > 0 && <CostBasis address={address} />}

      {pf && (
        <p className="tnum mt-6 text-xs text-[var(--muted)]">
          {pf.gas.toFixed(5)} ETH available for gas · balances read via scaledBalanceOf, so quantities
          already include the current B20 multiplier · marked at the live Chainlink price
          {pf.equity > 0 ? ` · ${compactUsd(pf.equity)} of equity exposure` : ""}
        </p>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg)] px-3 py-3 sm:px-5 sm:py-4">
      <div className="eyebrow truncate">{label}</div>
      <div className="tnum mt-1.5 text-base font-medium sm:text-lg">{value}</div>
    </div>
  );
}
