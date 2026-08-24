"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { useMarkets } from "@/lib/useMarkets";
import { Reveal, RevealWords } from "./Reveal";
import { Counter } from "./Counter";
import { Marquee } from "./Marquee";
import { MarketTable } from "./MarketTable";
import { Sparkline } from "./Sparkline";
import { AssetLogo } from "./AssetLogo";
import { compactUsd, compact } from "@/lib/format";

/* ------------------------------------------------------------------ */

/**
 * Infrastructure CAPIMON reads from. Each line names the actual dependency, so
 * the strip reads as an architecture note rather than a wall of logos.
 */
const STACK = [
  { name: "Base", role: "Settlement chain" },
  { name: "B20", role: "Token standard" },
  { name: "Chainlink", role: "Price feeds" },
  { name: "Coinbase", role: "Asset issuer" },
  { name: "USDC", role: "Settlement currency" },
  { name: "Uniswap v3", role: "Secondary venue" },
  { name: "OP Stack", role: "Rollup framework" },
];

export function StackStrip() {
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
            <span className="text-[11px] text-[var(--muted)]">{p.role}</span>
          </span>
        ))}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function ProductsSection() {
  const { data } = useMarkets();
  const markets = data?.markets ?? [];
  const tvl = data?.totals.tvl ?? 0;
  const equities = markets.length;
  const feeds = markets.filter((m) => m.updatedAt > 0).length;
  const top = [...markets].sort((a, b) => b.tvl - a.tvl).slice(0, 6);

  return (
    <section className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
      <Reveal>
        <div className="eyebrow">Our products</div>
        <h2 className="display mt-4 max-w-4xl text-[clamp(2.2rem,5.4vw,4.6rem)]">
          <RevealWords text="A new standard" />
          <br />
          <span className="font-[family-name:var(--font-serif)] font-light italic text-[var(--muted)]">
            <RevealWords text="for tokenized finance." delay={0.1} />
          </span>
        </h2>
        <p className="mt-6 max-w-lg font-[family-name:var(--font-serif)] text-lg text-[var(--muted)]">
          Three onchain surfaces bridging public markets and DeFi — all reading the same live state on Base.
        </p>
      </Reveal>

      <div className="mt-14 grid gap-4 lg:grid-cols-3">
        {/* Equities — the flagship */}
        <Reveal className="lg:col-span-2">
          <div className="group relative h-full overflow-hidden rounded-3xl border hairline p-7 transition-colors hover:border-[var(--color-accent)] sm:p-9">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-md">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--fg)] text-[var(--bg)]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <path d="M3 17l5-6 4 4 5-8" /><circle cx="12" cy="12" r="10" />
                  </svg>
                </div>
                <h3 className="mt-6 font-[family-name:var(--font-display)] text-3xl font-medium tracking-[-0.04em] sm:text-4xl">
                  CAPIMON Equities
                </h3>
                <p className="mt-3 font-[family-name:var(--font-serif)] text-[17px] leading-relaxed text-[var(--muted)]">
                  Public companies as B20 tokens on Base — freely transferable, composable in DeFi,
                  and marked continuously by Chainlink total-return feeds.
                </p>
                <span className="mt-4 inline-block rounded-full surface px-3 py-1 text-[11px] text-[var(--muted)]">
                  Not available to US persons
                </span>
              </div>

              <div className="grid flex-1 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:min-w-[280px] sm:grid-cols-2">
                <Stat label="Onchain value" value={<Counter value={tvl} format={compactUsd} />} />
                <Stat label="Assets" value={<Counter value={equities} format={(n) => Math.round(n).toString()} />} />
                <Stat label="Live feeds" value={<Counter value={feeds} format={(n) => `${Math.round(n)}/${equities}`} />} />
                <Stat label="Settlement" value="~2s" />
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2">
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

            <Link href="/markets" className="mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-5 py-3 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03]">
              Discover CAPIMON Equities <span>→</span>
            </Link>
          </div>
        </Reveal>

        <div className="grid gap-4">
          <Reveal delay={0.08}>
            <SideCard
              title="CAPIMON Vault"
              tag="Self-custody"
              body="Your positions live in your own wallet. CAPIMON reads Base directly — every balance on the portfolio page is an onchain read, not our ledger."
              stat={<Counter value={equities} format={(n) => `${Math.round(n)} assets`} />}
              statLabel="Tracked live"
              href="/portfolio"
              cta="Open portfolio"
            />
          </Reveal>
          <Reveal delay={0.16}>
            <SideCard
              title="CAPIMON Feeds"
              tag="Oracle"
              body="Total-return Chainlink feeds on Base, running 24/5 and freezing through corporate actions. Every chart on this site is drawn from onchain rounds."
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
  const { data } = useMarkets();
  return (
    <section className="border-y hairline">
      <div className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="eyebrow">Live board</div>
              <h2 className="display mt-3 text-[clamp(2rem,4.6vw,3.6rem)]">Everything, marked to the chain.</h2>
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
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const x = useTransform(scrollYProgress, [0, 1], ["4%", "-4%"]);
  const { data } = useMarkets();

  const totalSupply = (data?.markets ?? []).reduce((s, m) => s + m.supply, 0);
  const rounds = (data?.markets ?? []).reduce((s, m) => s + m.history.length, 0);

  return (
    <section ref={ref} className="overflow-hidden py-24 sm:py-32">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <Reveal>
          <h2 className="display max-w-3xl text-[clamp(2rem,5vw,4.2rem)]">
            <RevealWords text="CAPIMON is building the rails" />{" "}
            <span className="font-[family-name:var(--font-serif)] font-light italic text-[var(--muted)]">
              <RevealWords text="for the next market." delay={0.12} />
            </span>
          </h2>
        </Reveal>
      </div>

      <motion.div style={{ x }} className="mt-16 flex gap-4 px-5 sm:px-8">
        <BigStat label="Onchain value" value={<Counter value={data?.totals.tvl ?? 0} format={compactUsd} />} sub="supply × Chainlink mark" />
        <BigStat label="Share-equivalents" value={<Counter value={totalSupply} format={(n) => compact(n, 1)} />} sub="multiplier-adjusted" />
        <BigStat label="Oracle rounds read" value={<Counter value={rounds} format={(n) => Math.round(n).toLocaleString()} />} sub="this snapshot" />
        <BigStat label="Chain" value="Base" sub="8453 · OP Stack L2" />
        <BigStat label="Settlement" value="~2s" sub="block time" />
      </motion.div>
    </section>
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
    body: "A tokenized share is not an end state. It is collateral, it is a leg in a strategy, it is programmable — the same primitives DeFi already runs on.",
  },
];

export function BeliefSection() {
  return (
    <section className="border-y hairline">
      <div className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
        <Reveal>
          <div className="eyebrow">A message from CAPIMON</div>
          <h2 className="display mt-4 text-[clamp(2rem,5vw,4rem)]">We believe in</h2>
        </Reveal>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl bg-[var(--border)] md:grid-cols-3">
          {BELIEFS.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.1}>
              <div className="h-full bg-[var(--bg)] p-8">
                <div className="tnum text-xs text-[var(--muted)]">0{i + 1}</div>
                <h3 className="mt-6 font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.04em]">{b.title}</h3>
                <p className="mt-3 font-[family-name:var(--font-serif)] text-[17px] leading-relaxed text-[var(--muted)]">{b.body}</p>
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
  { t: "Verifiable marks", b: "Chainlink total-return feeds publish price × multiplier onchain. CAPIMON reads updatedAt and flags anything stale rather than showing a confident lie." },
  { t: "Policy-aware transfers", b: "Onchain policy registries gate transfers against sanctions lists. Holding and secondary transfer are permissionless; mint and redeem run under issuer KYC." },
  { t: "Corporate actions, onchain", b: "Splits and dividends move the WAD multiplier instead of rewriting balances. CAPIMON applies the current multiplier everywhere a share count is shown." },
  { t: "No custody", b: "CAPIMON never holds your assets or your keys. Positions are read from Base and every transaction is signed in your own wallet." },
];

export function PillarsSection() {
  return (
    <section className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <Reveal>
          <div className="lg:sticky lg:top-32">
            <div className="eyebrow">Institutional grade</div>
            <h2 className="display mt-4 text-[clamp(2rem,4.6vw,3.6rem)]">
              Serious plumbing,{" "}
              <span className="font-[family-name:var(--font-serif)] font-light italic text-[var(--muted)]">visible to everyone.</span>
            </h2>
            <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-[var(--muted)]">
              Every claim on this page resolves to an address on Base you can check yourself.
            </p>
          </div>
        </Reveal>

        <div>
          {PILLARS.map((p, i) => (
            <Reveal key={p.t} delay={i * 0.06}>
              <div className="group border-b hairline py-7 first:border-t">
                <div className="flex items-baseline gap-5">
                  <span className="tnum text-xs text-[var(--muted)]">0{i + 1}</span>
                  <div>
                    <h3 className="font-[family-name:var(--font-display)] text-xl font-medium tracking-[-0.03em] transition-colors group-hover:text-[var(--color-accent)]">
                      {p.t}
                    </h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{p.b}</p>
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
      <div className="mx-auto max-w-[1400px] px-5 py-28 text-center sm:px-8 sm:py-40">
        <Reveal>
          <div className="eyebrow">The future of markets</div>
          <h2 className="display mx-auto mt-5 max-w-4xl text-[clamp(2.4rem,6.5vw,5.5rem)]">
            <RevealWords text="Markets that never" />{" "}
            <span className="font-[family-name:var(--font-serif)] font-light italic">
              <RevealWords text="close on you." delay={0.12} />
            </span>
          </h2>
          <p className="mx-auto mt-7 max-w-xl font-[family-name:var(--font-serif)] text-lg text-[var(--muted)]">
            Connect a wallet and read your positions straight off Base. No account, no onboarding queue, no custody.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/markets" className="rounded-full bg-[var(--fg)] px-7 py-4 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03] active:scale-95">
              Explore markets →
            </Link>
            <Link href="/portfolio" className="rounded-full border hairline px-7 py-4 text-sm font-medium transition-colors hover:surface">
              Open portfolio
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
