"use client";

import Link from "next/link";
import { useCapimonAccount, useCurrency } from "@/lib/useCapimonAccount";
import { AssetLogo } from "./AssetLogo";
import { Counter } from "./Counter";
import { Reveal } from "./Reveal";
import { WalletSection } from "./WalletSection";
import { usd, costLabel } from "@/lib/format";

/** The book CAPX holds for a shilling-funded account. */
export function CustodialPortfolio() {
  const { account, signOut } = useCapimonAccount();
  /*
   * Most of the people using this earn, save and think in shillings, so the
   * page should be able to speak in them. The figures are held in dollars
   * because that is what the marks are quoted in; the choice here is only
   * about how they are read.
   */
  const { currency, setCurrency, canShowTzs, format: money } = useCurrency();
  if (!account) return null;

  const { tzs, cashTzs, positions, equity, total } = account;
  const shillings = tzs + (cashTzs ?? 0);
  // Return is the reason anyone opens this page; holdings and a value are only
  // the inputs to it.
  const pnl = account.pnl;
  const up = (pnl?.unrealised ?? 0) >= 0;
  const sign = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-7 sm:px-8 sm:pt-9">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="eyebrow">Portfolio</div>
            <h1 className="display mt-2 text-[clamp(1.6rem,4vw,2.9rem)]">Your book.</h1>
            <p className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
              {account.user.username ? `@${account.user.username}` : account.user.email}
              <span className="rounded-full surface px-2 py-0.5 text-[11px]">held by CAPX</span>
              {canShowTzs && (
                <span className="inline-flex overflow-hidden rounded-full border hairline text-[11px]">
                  {(["TZS", "USDC"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setCurrency(c)}
                      className={`px-2.5 py-0.5 transition-colors ${
                        currency === c ? "bg-[var(--fg)] text-[var(--bg)]" : "hover:surface"
                      }`}
                    >
                      {c === "USDC" ? "USD" : "TZS"}
                    </button>
                  ))}
                </span>
              )}
              <button onClick={signOut} className="underline underline-offset-2 hover:text-[var(--fg)]">Sign out</button>
            </p>
          </div>
          {/*
            * Return sits with the other totals rather than in a card below them.
            *
            * It was a full-width block carrying one number, which pushed the
            * holdings — the thing the page is for — off the first screen. It is
            * the most important figure here, so it belongs beside the others,
            * not in a room of its own.
            */}
          <div className="grid w-full grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-4 lg:w-auto">
            <Cell label="Shares" value={<Counter value={equity} format={money} />} />
            <Cell label="Cash" value={<Counter value={shillings} format={(n) => `${Math.round(n).toLocaleString()} TZS`} />} />
            <Cell label="Total value" value={<Counter value={total} format={money} />} />
            {pnl && pnl.invested > 0 ? (
              <Cell
                label="Return"
                value={
                  <span className={up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
                    {sign(pnl.unrealised)}
                    <span className="ml-1.5 text-[11px]">
                      {pnl.unrealisedPct >= 0 ? "+" : ""}{pnl.unrealisedPct.toFixed(1)}%
                    </span>
                  </span>
                }
                note={
                  Math.abs(pnl.realised) > 0.005
                    ? `${money(pnl.invested)} in · ${sign(pnl.realised)} banked`
                    : `${money(pnl.invested)} invested`
                }
              />
            ) : (
              <Cell label="Return" value="—" note="after your first buy" />
            )}
          </div>
        </div>
      </Reveal>

      {positions.length > 0 && (
        <Reveal delay={0.06} className="mt-4">
          <div id="holdings" className="grid gap-1.5 scroll-mt-24">
            {positions.map((p) => (
              <Link
                key={p.symbol}
                href={`/markets/${p.ticker.toLowerCase()}`}
                className="flex items-center gap-3 rounded-2xl border hairline px-4 py-3 transition-colors hover:surface"
              >
                <AssetLogo logo={p.logo} ticker={p.ticker} color={p.color} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium leading-tight">{p.ticker}</div>
                  <div className="tnum text-xs text-[var(--muted)]">
                    {p.qty.toFixed(6)}
                    {p.avgCostNative > 0 ? <> · avg {costLabel(p.avgCostNative, p.currency)}</> : <> @ {usd(p.price)}</>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tnum text-[14px] font-medium leading-tight">{money(p.value)}</div>
                  {/* Return on what this position cost, not the day's move —
                      the day's move is on the market page; this is the money. */}
                  {p.costBasis > 0 ? (
                    <div className={`tnum text-xs ${p.pnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                      {p.pnl >= 0 ? "+" : "−"}{money(Math.abs(p.pnl))} ({p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(1)}%)
                    </div>
                  ) : (
                    <div className={`tnum text-xs ${p.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                      {p.change >= 0 ? "+" : ""}{p.change.toFixed(2)}%
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      <WalletSection />

      <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
        CAPX holds these assets on your behalf and this ledger records what you are owed. Prefer
        to hold your own keys? <Link href="/markets" className="underline underline-offset-2">Connect a wallet</Link> and
        CAPX holds nothing.
      </p>
    </div>
  );
}

function Cell({ label, value, note }: {
  label: React.ReactNode; value: React.ReactNode;
  /** Context the figure needs, where a second card used to carry it. */
  note?: string;
}) {
  return (
    <div className="bg-[var(--bg)] px-3 py-3 sm:px-4 sm:py-3.5">
      <div className="eyebrow truncate">{label}</div>
      <div className="tnum mt-1 text-base font-medium sm:text-lg">{value}</div>
      {note && <div className="tnum mt-0.5 truncate text-[10px] text-[var(--muted)]">{note}</div>}
    </div>
  );
}
