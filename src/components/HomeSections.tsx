"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useDse, type DseListing } from "@/lib/useDse";
import { DseLogo } from "./DseLogo";
import type { Candle } from "@/lib/useMarkets";
import { useMarkets } from "@/lib/useMarkets";
import { Reveal, RevealWords } from "./Reveal";
import { Counter } from "./Counter";
import { Marquee } from "./Marquee";
import { MarketTable } from "./MarketTable";
import { Sparkline } from "./Sparkline";
import { AssetLogo } from "./AssetLogo";
import { compactUsd, compact } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { TAGLINE } from "./Logo";

/* ------------------------------------------------------------------ */

/**
 * Infrastructure CAPX reads from. Each line names the actual dependency, so
 * the strip reads as an architecture note rather than a wall of logos.
 */
const STACK = [
  { name: "DSE", role: "Listed market" },
  { name: "nTZS", role: "Shilling settlement" },
  { name: "Base", role: "Settlement chain" },
  { name: "B20", role: "Token standard" },
  { name: "Chainlink", role: "Price feeds" },
  { name: "Coinbase", role: "Asset issuer" },
  { name: "USDC", role: "Settlement currency" },
  { name: "Uniswap v3", role: "Secondary venue" },
  { name: "OP Stack", role: "Rollup framework" },
];

export function StackStrip() {
  const { t } = useT();
  return (
    <section className="border-y hairline py-7">
      <div className="mx-auto mb-5 max-w-[1400px] px-5 sm:px-8">
        <span className="eyebrow">Built on the world&rsquo;s most trusted infrastructure</span>
      </div>
      <Marquee
        duration={48}
        items={STACK.map((p) => (
          <span key={p.name} className="flex items-baseline gap-2.5">
            <span className="font-[family-name:var(--font-display)] text-xl font-medium tracking-[-0.03em] sm:text-2xl">
              {p.name}
            </span>
            <span className="text-[11px] text-[var(--muted)]">{t(p.role)}</span>
          </span>
        ))}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The DSE listings, as a compact board.
 *
 * It used to be one CRDB card the height of a screen, which said "one bank"
 * where the point is "the Tanzanian market". Every tokenised listing now gets
 * a card of the same size — CRDB, NMB, and whatever is added next with no
 * code — and the facts that are true of all of them (same-day settlement,
 * the fee, no minimum) are said once instead of repeated per company.
 */
export function DseSection() {
  const { t } = useT();
  const listings = useDse().filter((d) => d.status === "live");

  return (
    <section className="mx-auto max-w-[1400px] px-5 pt-10 sm:px-8 sm:pt-16 lg:pt-20">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <div className="eyebrow">{t("Dar es Salaam Stock Exchange")}</div>
            <h2 className="display mt-3 text-[clamp(1.6rem,4.2vw,3.2rem)]">
              {t("Tanzanian shares,")}{" "}
              <span className="contra text-[var(--muted)]">{t("in shillings, same day.")}</span>
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {[
              ["T+0", t("Settlement")],
              ["1%", t("Fee")],
              [t("None"), t("Minimum lot")],
            ].map(([v, k]) => (
              <span key={k} className="inline-flex items-baseline gap-1.5 rounded-full border hairline px-3 py-1.5">
                <span className="tnum font-medium">{v}</span>
                <span className="text-[var(--muted)]">{k}</span>
              </span>
            ))}
          </div>
        </div>
      </Reveal>

      {/* A swipeable row on phones, a grid from tablets up. */}
      <div className="scroll-thin -mx-5 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {listings.length === 0
          ? [0, 1].map((i) => <div key={i} className="h-44 w-[80%] shrink-0 animate-pulse rounded-3xl surface sm:w-auto" />)
          : listings.map((d) => <DseCard key={d.symbol} d={d} />)}
        {/* Closes the row so a short list never leaves a hole in the grid. */}
        {listings.length > 0 && (
          <Link href="/markets"
            className="group flex w-[60%] shrink-0 snap-start flex-col justify-between rounded-3xl border border-dashed hairline p-5 text-[var(--muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--fg)] sm:w-auto">
            <span className="eyebrow">{t("And more")}</span>
            <span className="mt-6 text-lg font-medium text-[var(--fg)]">
              {t("US equities, from the same account")}
            </span>
            <span className="mt-3 text-[12px] font-medium">
              {t("All markets")} <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
        )}
      </div>
    </section>
  );
}

function DseCard({ d }: { d: DseListing }) {
  const { t } = useT();
  const [hist, setHist] = useState<Candle[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/securities/${d.symbol.toLowerCase()}/history`)
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setHist(j.candles ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [d.symbol]);
  const first = hist[0]?.p;
  const last = d.price || hist[hist.length - 1]?.p;
  const yearPct = first && last ? ((last - first) / first) * 100 : null;
  const up = d.changePct >= 0;

  return (
    <Link
      href={`/markets/${d.symbol.toLowerCase()}`}
      className="group relative flex w-[80%] shrink-0 snap-start flex-col overflow-hidden rounded-3xl border hairline p-5 transition-colors hover:border-[var(--color-accent)] sm:w-auto"
    >
      <div className="flex items-center gap-3">
        <DseLogo logo={d.logo} symbol={d.symbol} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-tight">{d.symbol}</div>
          <div className="truncate text-[12px] text-[var(--muted)]">{d.name}</div>
        </div>
        <div className="text-right">
          <div className="tnum text-lg font-medium">
            {d.price > 0 ? `TSh ${d.price.toLocaleString("en-TZ", { maximumFractionDigits: 0 })}` : "—"}
          </div>
          {d.source === "oracle" ? (
            <div className="text-[11px] text-[#b45309]">{t("Last price")}</div>
          ) : (
            <div className={`tnum text-[11px] ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
              {up ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}% {t("today")}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 h-14 [&>svg]:h-14 [&>svg]:w-full">
        {hist.length > 4 && (
          <Sparkline data={hist} color={yearPct !== null && yearPct < 0 ? "var(--color-down)" : "var(--color-up)"}
            width={400} height={56} strokeWidth={1.75} />
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px]">
        <span className="text-[var(--muted)]">
          {t("1 year")}{" "}
          <span className={`tnum font-medium ${yearPct !== null && yearPct < 0 ? "text-[var(--color-down)]" : "text-[var(--fg)]"}`}>
            {yearPct === null ? "—" : `${yearPct >= 0 ? "+" : ""}${yearPct.toFixed(0)}%`}
          </span>
        </span>
        <span className="font-medium transition-transform group-hover:translate-x-0.5">
          {t("Buy")} {d.symbol} →
        </span>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */

export function ProductsSection() {
  const { t } = useT();
  const { data } = useMarkets();
  const markets = data?.markets ?? [];
  const tvl = data?.totals.tvl ?? 0;
  const equities = markets.length;
  const feeds = markets.filter((m) => m.updatedAt > 0).length;
  const top = [...markets].sort((a, b) => b.tvl - a.tvl).slice(0, 6);

  return (
    <section className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-24 lg:py-32">
      <Reveal>
        <div className="eyebrow">{t("And beyond the DSE")}</div>
        <h2 className="display mt-4 max-w-4xl text-[clamp(1.8rem,5.4vw,4.6rem)]">
          <RevealWords text={t("The world's companies,")} />
          <br />
          <span className="contra text-[var(--muted)]">
            <RevealWords text={t("from the same account.")} delay={0.1} />
          </span>
        </h2>
        <p className="mt-6 max-w-lg text-lg text-[var(--muted)]">
          {t("The same shillings buy US equities too, priced by Chainlink and settled onchain.")}
        </p>
      </Reveal>

      <div className="mt-8 sm:mt-14 grid gap-4 lg:grid-cols-3">
        {/* Equities — the flagship */}
        <Reveal className="lg:col-span-2">
          <div className="group relative h-full overflow-hidden rounded-3xl border hairline p-5 transition-colors hover:border-[var(--color-accent)] sm:p-7 lg:p-9">
            <div className="flex flex-wrap items-start justify-between gap-5 sm:gap-6">
              <div className="max-w-md">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--fg)] text-[var(--bg)]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <path d="M3 17l5-6 4 4 5-8" /><circle cx="12" cy="12" r="10" />
                  </svg>
                </div>
                <h3 className="mt-4 sm:mt-6 font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.04em] sm:text-3xl lg:text-4xl">
                  {t("US equities")}
                </h3>
                <p className="mt-3 text-[17px] leading-relaxed text-[var(--muted)]">
                  Public companies as B20 tokens. Freely transferable, composable in DeFi,
                  and marked continuously by Chainlink total-return feeds.
                </p>
                <span className="mt-4 inline-block rounded-full surface px-3 py-1 text-[11px] text-[var(--muted)]">
                  {t("Not available to US persons")}
                </span>
              </div>

              <div className="grid flex-1 grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:min-w-[280px]">
                <Stat label={t("Onchain value")} value={<Counter value={tvl} format={compactUsd} />} />
                <Stat label="Assets" value={<Counter value={equities} format={(n) => Math.round(n).toString()} />} />
                <Stat label={t("Live feeds")} value={<Counter value={feeds} format={(n) => `${Math.round(n)}/${equities}`} />} />
                <Stat label="Settlement" value="~2s" />
              </div>
            </div>

            <div className="mt-6 sm:mt-8 flex flex-wrap items-center gap-2">
              {top.map((m) => (
                <Link
                  key={m.symbol}
                  href={`/markets/${m.ticker.toLowerCase()}`}
                  className="flex items-center gap-2 rounded-full border hairline px-3 py-1.5 text-xs transition-transform hover:scale-105"
                >
                  <AssetLogo logo={m.logo} ticker={m.ticker} color={m.color} size={16} />
                  <span className="font-medium">{m.ticker}</span>
                  <span className="tnum text-[var(--muted)]">${m.price.toFixed(2)}</span>
                  <span className={`tnum ${m.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                    {m.change >= 0 ? "+" : ""}{m.change.toFixed(1)}%
                  </span>
                </Link>
              ))}
            </div>

            <Link href="/markets" className="mt-6 sm:mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-5 py-3 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03]">
              {t("Browse US equities")} <span>→</span>
            </Link>
          </div>
        </Reveal>

        <div className="grid gap-4">
          <Reveal delay={0.08}>
            <SideCard
              title={t("CAPX Vault")}
              tag="Self-custody"
              body="Your positions live in your own wallet. CAPX reads the chain directly, so every balance on the portfolio page is an onchain read rather than our ledger."
              stat={<Counter value={equities} format={(n) => `${Math.round(n)} assets`} />}
              statLabel="Tracked live"
              href="/portfolio"
              cta="Open portfolio"
            />
          </Reveal>
          <Reveal delay={0.16}>
            <SideCard
              title={t("CAPX Feeds")}
              tag="Oracle"
              body="Total-return Chainlink feeds, running 24/5 and freezing through corporate actions. Every chart on this site is drawn from onchain rounds."
              stat={<span className="tnum">8 dp</span>}
              statLabel="Feed precision"
              href="/how-it-works"
              cta="See the plumbing"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg)] p-4">
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-1.5 text-xl font-medium">{value}</div>
    </div>
  );
}

function SideCard({
  title, tag, body, stat, statLabel, href, cta,
}: { title: string; tag: string; body: string; stat: React.ReactNode; statLabel: string; href: string; cta: string }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-3xl border hairline p-7 transition-colors hover:border-[var(--color-accent)]">
      <div>
        <span className="eyebrow">{tag}</span>
        <h3 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.04em]">{title}</h3>
        <p className="mt-2.5 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
      </div>
      <div className="mt-6">
        <div className="tnum text-2xl font-medium">{stat}</div>
        <div className="eyebrow mt-0.5">{statLabel}</div>
        <Link href={href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-[var(--color-accent)]">
          {cta} <span>→</span>
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function LiveBoard() {
  const { t } = useT();
  const { data } = useMarkets();
  return (
    <section className="border-y hairline">
      <div className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-20 lg:py-28">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="eyebrow">{t("Live board")}</div>
              <h2 className="display mt-3 text-[clamp(1.65rem,4.6vw,3.6rem)]">{t("Everything, marked to the chain.")}</h2>
            </div>
            <Link href="/markets" className="rounded-full border hairline px-5 py-2.5 text-sm transition-colors hover:surface">
              View all {data?.totals.assets ?? ""} markets →
            </Link>
          </div>
        </Reveal>
        <Reveal delay={0.1} className="mt-10">
          <MarketTable limit={6} showSearch={false} />
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/** Scroll-pinned numbers pulled from the same live snapshot as everything else. */
export function StatsBand() {
  const { t } = useT();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const x = useTransform(scrollYProgress, [0, 1], ["4%", "-4%"]);
  const { data } = useMarkets();

  const totalSupply = (data?.markets ?? []).reduce((s, m) => s + m.supply, 0);
  const rounds = (data?.markets ?? []).reduce((s, m) => s + m.history.length, 0);

  return (
    <section ref={ref} className="overflow-hidden py-14 sm:py-24 lg:py-32">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <Reveal>
          <h2 className="display max-w-3xl text-[clamp(1.65rem,5vw,4.2rem)]">
            <RevealWords text="CAPX is building the rails" />{" "}
            <span className="contra text-[var(--muted)]">
              <RevealWords text="for the next market." delay={0.12} />
            </span>
          </h2>
        </Reveal>
      </div>

      {/* Phones: stacked figures with rules, which reads far better than a
          horizontal rail you cannot see the end of. */}
      <div className="mt-10 px-5 sm:hidden">
        <StackedStat label={t("Onchain value")} value={<Counter value={data?.totals.tvl ?? 0} format={compactUsd} />} sub="supply × Chainlink mark" />
        <StackedStat label="Share-equivalents" value={<Counter value={totalSupply} format={(n) => compact(n, 1)} />} sub="multiplier-adjusted" />
        <StackedStat label={t("Oracle rounds read")} value={<Counter value={rounds} format={(n) => Math.round(n).toLocaleString()} />} sub="this snapshot" />
        <StackedStat label="Settlement" value="~2s" sub="block time" />
      </div>

      <motion.div style={{ x }} className="mt-16 hidden gap-4 px-5 sm:flex sm:px-8">
        <BigStat label={t("Onchain value")} value={<Counter value={data?.totals.tvl ?? 0} format={compactUsd} />} sub="supply × Chainlink mark" />
        <BigStat label="Share-equivalents" value={<Counter value={totalSupply} format={(n) => compact(n, 1)} />} sub="multiplier-adjusted" />
        <BigStat label={t("Oracle rounds read")} value={<Counter value={rounds} format={(n) => Math.round(n).toLocaleString()} />} sub="this snapshot" />
        <BigStat label="Settlement" value="~2s" sub="block time" />
      </motion.div>
    </section>
  );
}

function StackedStat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b hairline py-6 first:border-t">
      <div className="tnum text-[clamp(2.2rem,13vw,3.4rem)] font-medium leading-none tracking-tight">{value}</div>
      <div className="max-w-[42%] text-right">
        <div className="text-[15px] leading-tight">{label}</div>
        <div className="mt-1 text-[11px] text-[var(--muted)]">{sub}</div>
      </div>
    </div>
  );
}

function BigStat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="min-w-[240px] flex-1 rounded-3xl border hairline p-7">
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-4 text-[clamp(1.9rem,3.4vw,3rem)] font-medium tracking-tight">{value}</div>
      <div className="mt-2 text-xs text-[var(--muted)]">{sub}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const BELIEFS = [
  {
    title: "Open access",
    body: "A brokerage account should not be a passport check. Anyone with a wallet and an internet connection can hold an asset that settles on a public chain.",
  },
  {
    title: "Honest infrastructure",
    body: "Prices come from an oracle you can verify, supply comes from a contract you can read, and balances live in a wallet you control. Nothing here is a screenshot of a database.",
  },
  {
    title: "Composability",
    body: "A tokenized share is not an end state. It is collateral, it is a leg in a strategy, it is programmable. The same primitives DeFi already runs on.",
  },
];

export function BeliefSection() {
  const { t } = useT();
  return (
    <section className="border-y hairline">
      <div className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-24 lg:py-32">
        <Reveal>
          <div className="eyebrow">{t("A message from CAPX")}</div>
          <h2 className="display mt-4 text-[clamp(1.65rem,5vw,4rem)]">We believe in</h2>
        </Reveal>
        <div className="mt-8 sm:mt-14 grid gap-px overflow-hidden rounded-3xl bg-[var(--border)] md:grid-cols-3">
          {BELIEFS.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.1}>
              <div className="h-full bg-[var(--bg)] p-8">
                <div className="tnum text-xs text-[var(--muted)]">0{i + 1}</div>
                <h3 className="mt-6 font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.04em]">{t(b.title)}</h3>
                <p className="mt-3 text-[17px] leading-relaxed text-[var(--muted)]">{t(b.body)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const PILLARS = [
  { t: "Native precompiles", b: "B20 tokens are not redeployed contracts. They are native to Base, audited by Base and Spearbit, with Cantina and HackerOne bounty coverage." },
  { t: "Verifiable marks", b: "Chainlink total-return feeds publish price × multiplier onchain. CAPX reads updatedAt and flags anything stale rather than showing a confident lie." },
  { t: "Policy-aware transfers", b: "Onchain policy registries gate transfers against sanctions lists. Holding and secondary transfer are permissionless; mint and redeem run under issuer KYC." },
  { t: "Corporate actions, onchain", b: "Splits and dividends move the WAD multiplier instead of rewriting balances. CAPX applies the current multiplier everywhere a share count is shown." },
  { t: "Custody is a choice", b: "Connect your own wallet and CAPX never holds your assets or your keys. Positions are read from the chain and you sign every transaction. Accounts funded with shillings are custodial: CAPX holds those assets for you and records what you are owed." },
];

export function PillarsSection() {
  const { t } = useT();
  return (
    <section className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-24 lg:py-32">
      <div className="grid gap-8 sm:gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <Reveal>
          <div className="lg:sticky lg:top-32">
            <div className="eyebrow">{t("Institutional grade")}</div>
            <h2 className="display mt-4 text-[clamp(1.65rem,4.6vw,3.6rem)]">
              Serious plumbing,{" "}
              <span className="contra text-[var(--muted)]">visible to everyone.</span>
            </h2>
            <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-[var(--muted)]">
              {t("Every claim on this page resolves to an onchain address you can check yourself.")}
            </p>
          </div>
        </Reveal>

        <div>
          {PILLARS.map((p, i) => (
            <Reveal key={p.t} delay={i * 0.06}>
              <div className="group border-b hairline py-5 sm:py-7 first:border-t">
                <div className="flex items-baseline gap-5">
                  <span className="tnum text-xs text-[var(--muted)]">0{i + 1}</span>
                  <div>
                    <h3 className="font-[family-name:var(--font-display)] text-xl font-medium tracking-[-0.03em] transition-colors group-hover:text-[var(--color-accent)]">
                      {t(p.t)}
                    </h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{t(p.b)}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function ClosingCTA() {
  const { t } = useT();
  const { data } = useMarkets();
  const spark = data?.markets.find((m) => m.history.length > 4);

  return (
    <section className="relative overflow-hidden border-t hairline">
      <div className="absolute inset-0 -z-10 opacity-[0.07]">
        {spark && (
          <div className="absolute inset-x-0 bottom-0">
            <Sparkline data={spark.history} color="var(--color-accent)" width={1400} height={280} strokeWidth={2} />
          </div>
        )}
      </div>
      <div className="mx-auto max-w-[1400px] px-5 py-16 text-center sm:px-8 sm:py-28 lg:py-40">
        <Reveal>
          <div className="eyebrow">{TAGLINE}</div>
          <h2 className="display mx-auto mt-5 max-w-4xl text-[clamp(1.95rem,6.5vw,5.5rem)]">
            <RevealWords text={t("Your shillings,")} />{" "}
            <span className="contra">
              <RevealWords text={t("from the DSE to Wall Street.")} delay={0.12} />
            </span>
          </h2>
          <p className="mx-auto mt-7 max-w-xl text-lg text-[var(--muted)]">
            {t("One account, funded from mobile money or your bank. Own CRDB on the Dar es Salaam Stock Exchange the same day, and US names like NVIDIA and Apple alongside it.")}
          </p>
          {/* The two markets as facts, not adjectives: what is live on each. */}
          <div className="mt-7 flex flex-wrap justify-center gap-2 text-[12px]">
            <span className="inline-flex items-center gap-2 rounded-full border hairline px-3.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-up)]" />
              {t("DSE")} · CRDB · {t("in shillings")}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border hairline px-3.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-up)]" />
              {t("US stocks")} · {data?.markets.length ?? 13} {t("names")} · {t("in dollars")}
            </span>
          </div>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/markets/crdb" className="rounded-full bg-[var(--fg)] px-7 py-4 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03] active:scale-95">
              {t("Buy CRDB")} →
            </Link>
            <Link href="/markets" className="rounded-full border hairline px-7 py-4 text-sm font-medium transition-colors hover:surface">
              {t("Browse US stocks")} →
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
