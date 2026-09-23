"use client";

import Link from "next/link";
import { useCapimonAccount, useCurrency } from "@/lib/useCapimonAccount";
import { AssetLogo } from "./AssetLogo";
import { Counter } from "./Counter";
import { Reveal } from "./Reveal";
import { WalletSection } from "./WalletSection";
import { KycPrompt } from "./KycPrompt";
import { RecurringBuys } from "./RecurringBuys";
import { useDse } from "@/lib/useDse";
import { usd, costLabel } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { NtzsIcon } from "./icons/Ntzs";

/** The book CAPX holds for a shilling-funded account. */
export function CustodialPortfolio() {
  const { t } = useT();
  const { account } = useCapimonAccount();
  /*
   * Most of the people using this earn, save and think in shillings, so the
   * page should be able to speak in them. The figures are held in dollars
   * because that is what the marks are quoted in; the choice here is only
   * about how they are read.
   */
  const { currency, setCurrency, canShowTzs, format: money } = useCurrency();
  // Hooks before the early return: a plan can only be made in something live.
  const dse = useDse();
  if (!account) return null;

  const { tzs, cashTzs, positions, equity, total } = account;
  const shillings = tzs + (cashTzs ?? 0);
  // Return is the reason anyone opens this page; holdings and a value are only
  // the inputs to it.
  const pnl = account.pnl;
  const up = (pnl?.unrealised ?? 0) >= 0;
  const sign = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;

  return (
    /*
      * Narrower than the marketing pages on purpose.
      *
      * 1400px is right for a wall of markets; for a book with a balance, four
      * figures and a handful of holdings it stretched every row across a
      * monitor and left the reader's eye travelling between a label on one
      * side and its number on the other.
      */
    <div className="mx-auto max-w-[1080px] px-4 pb-12 pt-3 sm:px-8 sm:pt-9">
      {/*
        * The balance is the headline.
        *
        * The page opened on a title, a line of account details and a grid of
        * four equal cells, so the number anyone opens a portfolio for was one
        * small figure among four, a third of the way down. It now leads, large,
        * with the return under it, the split into shares and cash as a thin
        * strip, and the account line reduced to one row of small print. Sign
        * out lives in Account, where people look for it.
        */}
      <Reveal>
        <div className="flex items-center justify-between gap-3 text-[12px] text-[var(--muted)]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{account.user.username ? `@${account.user.username}` : account.user.email}</span>
          </span>
          {canShowTzs && (
            <span className="inline-flex shrink-0 overflow-hidden rounded-full border hairline text-[11px]">
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
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <div className="eyebrow">{t("Total value")}</div>
            <div className="tnum mt-1 text-[clamp(1.9rem,7vw,3rem)] font-medium leading-none tracking-tight">
              <Counter value={total} format={money} />
            </div>
            <div className="tnum mt-1.5 text-[13px]">
              {pnl && pnl.invested > 0 ? (
                <>
                  <span className={up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
                    {sign(pnl.unrealised)} ({pnl.unrealisedPct >= 0 ? "+" : ""}{pnl.unrealisedPct.toFixed(1)}%)
                  </span>
                  <span className="text-[var(--muted)]">
                    {" "}· {Math.abs(pnl.realised) > 0.005
                      ? `${money(pnl.invested)} in · ${sign(pnl.realised)} banked`
                      : `${money(pnl.invested)} ${t("invested")}`}
                  </span>
                </>
              ) : (
                <span className="text-[var(--muted)]">{t("Return shows after your first buy")}</span>
              )}
            </div>
          </div>

          <div className="grid w-full grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:w-auto sm:min-w-[340px]">
            <Cell label={t("Shares")} value={<Counter value={equity} format={money} />} />
            <Cell
              label={t("Cash")}
              value={
                <span className="flex items-center gap-1.5">
                  <NtzsIcon className="h-4 w-4" />
                  <Counter value={shillings} format={(n) => `${Math.round(n).toLocaleString()} TZS`} />
                </span>
              }
            />
          </div>
        </div>
      </Reveal>


      {/* Above the money, because an unverified account is a limit on what
          they can do with it. */}
      <div className="mt-3"><KycPrompt /></div>

      {/*
        * Under the balance, because a standing order spends it.
        *
        * A plan is only offered in something that is actually trading: an
        * external listing that has closed, or a suspended share, would take
        * the money and refuse the order every month.
        */}
      <RecurringBuys securities={dse.filter((d) => d.status === "live").map((d) => ({ symbol: d.symbol, name: d.name }))} />

      {/*
        * Money first, then what it bought.
        *
        * The cash panel used to sit under a second hero heading below the
        * holdings, so the page opened on what a customer owns and ended on
        * what they can spend. Handing the holdings to the wallet puts them in
        * one column in the order someone actually uses them.
        */}
      <WalletSection
        holdings={positions.length > 0 ? (
                  <Reveal delay={0.06} className="mt-3">
                    <div id="holdings" className="grid gap-1.5 scroll-mt-24">
                      {positions.map((p) => (
                        <Link
                          key={p.symbol}
                          href={`/markets/${p.ticker.toLowerCase()}`}
                          className="flex items-center gap-3 rounded-2xl border hairline px-3.5 py-2.5 transition-colors hover:surface"
                        >
                          <AssetLogo logo={p.logo} ticker={p.ticker} color={p.color} size={34} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-medium leading-tight">{p.ticker}</div>
                            <div className="tnum text-xs text-[var(--muted)]">
                              {p.qty.toLocaleString("en-US", { maximumFractionDigits: 8 })}
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
        ) : null}
      />

    </div>
  );
}

function Cell({ label, value, note }: {
  label: React.ReactNode; value: React.ReactNode;
  /** Context the figure needs, where a second card used to carry it. */
  note?: string;
}) {
  return (
    <div className="bg-[var(--bg)] px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="eyebrow truncate">{label}</div>
      <div className="tnum mt-0.5 text-[15px] font-medium sm:text-lg">{value}</div>
      {note && <div className="tnum mt-0.5 truncate text-[10px] text-[var(--muted)]">{note}</div>}
    </div>
  );
}
