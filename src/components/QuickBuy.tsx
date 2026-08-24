"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useMarkets } from "@/lib/useMarkets";
import { useVenues } from "@/lib/useVenues";
import { Sparkline } from "./Sparkline";
import { Reveal, RevealWords } from "./Reveal";
import { UsdcIcon } from "./icons/Usdc";
import { usd } from "@/lib/format";

const PRESETS = [50, 100, 500, 1000];

/**
 * Landing-page quick buy. Pick a USDC amount, pick a company, and the panel
 * shows the live oracle-implied position — then hands the whole intent to the
 * asset page, which owns the actual execution.
 */
export function QuickBuy() {
  const { data, ticks } = useMarkets();
  const { venues } = useVenues();
  const router = useRouter();
  const [amount, setAmount] = useState(100);
  const [custom, setCustom] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  // Routable assets first — a quick-buy panel should lead with what can
  // actually be bought right now.
  const markets = useMemo(() => {
    const rank = (sym: string) => (venues[sym]?.tradeable ? 0 : 1);
    return [...(data?.markets ?? [])].sort(
      (a, b) => rank(a.symbol) - rank(b.symbol) || b.tvl - a.tvl || a.ticker.localeCompare(b.ticker),
    );
  }, [data, venues]);
  const selected = markets.find((m) => m.ticker === picked) ?? markets[0];
  const selectedVenue = selected ? venues[selected.symbol] : undefined;
  const units = selected && selected.price > 0 ? amount / selected.price : 0;

  const setPreset = (n: number) => { setAmount(n); setCustom(""); };
  const onCustom = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setCustom(clean);
    const n = Number(clean);
    if (n > 0) setAmount(n);
  };

  const go = () => {
    if (!selected) return;
    router.push(`/markets/${selected.ticker.toLowerCase()}?side=buy&amount=${amount}`);
  };

  return (
    <section className="border-y hairline">
      <div className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <Reveal>
            <div className="lg:sticky lg:top-36">
              <div className="eyebrow">Quick buy</div>
              <h2 className="display mt-4 text-[clamp(2rem,4.6vw,3.6rem)]">
                <RevealWords text="Pick an amount." />
                <br />
                <span className="font-[family-name:var(--font-serif)] font-light italic text-[var(--muted)]">
                  <RevealWords text="Pick a company." delay={0.1} />
                </span>
              </h2>
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[var(--muted)]">
                Everything settles in USDC on Base. Choose a size and an asset — CAPIMON
                shows the live oracle-implied position before you go anywhere near a signature.
              </p>

              <div className="mt-7">
                <div className="eyebrow flex items-center gap-1.5">
                  <UsdcIcon className="h-3.5 w-3.5" /> You pay · USDC
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPreset(p)}
                      className={`tnum rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                        amount === p && !custom
                          ? "border-transparent bg-[var(--fg)] text-[var(--bg)]"
                          : "hairline hover:surface"
                      }`}
                    >
                      ${p.toLocaleString()}
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5 rounded-full border hairline px-3 py-2 focus-within:border-[var(--color-accent)]">
                    <UsdcIcon className="h-4 w-4 shrink-0" />
                    <input
                      value={custom}
                      onChange={(e) => onCustom(e.target.value)}
                      inputMode="decimal"
                      placeholder="Custom"
                      className="tnum w-20 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="rounded-3xl border hairline p-4 sm:p-6">
              <div className="eyebrow px-1">Choose a company · live marks</div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {markets.length === 0 &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-[86px] animate-pulse rounded-2xl surface" />
                  ))}

                {markets.map((m) => {
                  const active = selected?.ticker === m.ticker;
                  const tick = ticks[m.symbol];
                  return (
                    <button
                      key={m.symbol}
                      onClick={() => setPicked(m.ticker)}
                      className={`group relative rounded-2xl border p-3.5 text-left transition-all ${
                        active ? "border-[var(--color-accent)] surface" : "hairline hover:surface"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
                          style={{ background: m.color }}
                        >
                          {m.ticker.slice(0, 2)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-tight">{m.ticker}</span>
                          <span className="block truncate text-[11px] leading-tight text-[var(--muted)]">{m.name}</span>
                        </span>
                        <Sparkline
                          data={m.history.slice(-20)}
                          color={m.change >= 0 ? "var(--color-up)" : "var(--color-down)"}
                          width={38} height={18} fill={false}
                        />
                        {venues[m.symbol]?.tradeable && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-up)]" title="Routable now" />
                        )}
                      </div>
                      <div className="mt-2.5 flex items-baseline justify-between gap-2">
                        <span className={`tnum text-sm ${tick === "up" ? "flash-up" : tick === "down" ? "flash-down" : ""}`}>
                          {usd(m.price)}
                        </span>
                        <span className={`tnum text-[11px] ${m.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                          {m.change >= 0 ? "+" : ""}{m.change.toFixed(2)}%
                        </span>
                      </div>
                      {active && (
                        <motion.span
                          layoutId="quickbuy-ring"
                          className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-[var(--color-accent)]"
                          transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Live receipt for the current selection */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl surface p-5">
                <div>
                  <div className="eyebrow">You receive · oracle-implied</div>
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={`${selected?.ticker}-${units.toFixed(6)}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="tnum mt-1.5 flex items-baseline gap-2 text-3xl font-medium tracking-tight"
                    >
                      {units.toFixed(6)}
                      <span className="text-sm text-[var(--muted)]">{selected?.symbol ?? "—"}</span>
                    </motion.div>
                  </AnimatePresence>
                  <div className="tnum mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
                    <UsdcIcon className="h-3.5 w-3.5" />
                    {usd(amount)} at {selected ? usd(selected.price) : "—"} ·{" "}
                    {selectedVenue
                      ? selectedVenue.tradeable
                        ? `routing via ${selectedVenue.venues.join(" + ")}`
                        : "no secondary market yet — mint only"
                      : "checking routes…"}
                  </div>
                </div>

                <button
                  onClick={go}
                  disabled={!selected}
                  className="group inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-6 py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-50"
                >
                  Review {selected?.ticker ?? ""} order
                  <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </button>
              </div>

              <p className="mt-3 px-1 text-[11px] leading-relaxed text-[var(--muted)]">
                An oracle-implied figure. The asset page aggregates every venue on Base for a real
                executable quote, and says plainly when an asset has no secondary market yet.{" "}
                <Link href="/how-it-works" className="underline underline-offset-2 hover:text-[var(--fg)]">
                  How it works
                </Link>
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
