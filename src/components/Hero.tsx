"use client";

import Link from "next/link";
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { useMarkets } from "@/lib/useMarkets";
import { Counter } from "./Counter";
import { RevealWords } from "./Reveal";
import { compactUsd } from "@/lib/format";
import { Sparkline } from "./Sparkline";

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "22%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.12]);

  const { data } = useMarkets();
  const tvl = data?.totals.tvl ?? 0;
  const movers = [...(data?.markets ?? [])].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3);

  return (
    <section ref={ref} className="relative isolate flex min-h-[88vh] flex-col justify-center overflow-hidden [@supports(height:100dvh)]:min-h-[88dvh]">
      {/* Living mesh backdrop — cheap, GPU-only, and it never blocks the type. */}
      <motion.div style={reduced ? undefined : { scale }} className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[var(--bg)]" />
        <motion.div
          animate={reduced ? undefined : { x: [0, 60, -30, 0], y: [0, -40, 30, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -left-[10%] top-[6%] h-[46vw] w-[46vw] rounded-full blur-[100px]"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--color-accent) 42%, transparent), transparent 70%)" }}
        />
        <motion.div
          animate={reduced ? undefined : { x: [0, -70, 40, 0], y: [0, 50, -20, 0] }}
          transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -right-[8%] top-[26%] h-[40vw] w-[40vw] rounded-full blur-[110px]"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, #34d1bf 34%, transparent), transparent 70%)" }}
        />
        <motion.div
          animate={reduced ? undefined : { x: [0, 40, -50, 0], y: [0, -30, 40, 0] }}
          transition={{ duration: 38, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-[2%] left-[26%] h-[36vw] w-[36vw] rounded-full blur-[110px]"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, #ffb86b 30%, transparent), transparent 70%)" }}
        />
        <div className="grain absolute inset-0 mix-blend-overlay" />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg)]/10 via-transparent to-[var(--bg)]" />
      </motion.div>

      <motion.div style={reduced ? undefined : { y, opacity }} className="mx-auto w-full max-w-[1400px] px-5 pb-16 pt-20 sm:px-8">
        <h1 className="display text-[clamp(2.9rem,9vw,8.5rem)]">
          <RevealWords text="Own the open" />
          <br />
          <span className="italic font-[family-name:var(--font-serif)] font-light tracking-[-0.02em]">
            <RevealWords text="market." delay={0.16} />
          </span>
        </h1>

        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between"
        >
          <p className="max-w-xl font-[family-name:var(--font-serif)] text-lg leading-relaxed text-[var(--muted)] sm:text-xl">
            CAPIMON puts public equities onchain as B20 tokens on Base. Live Chainlink marks,
            real onchain supply, permissionless secondary transfer, and self-custody —
            no broker, no closing bell for settlement.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/markets"
              className="group inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-6 py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03] active:scale-95"
            >
              Explore markets
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
            <Link
              href="/how-it-works"
              className="rounded-full border hairline bg-[var(--bg)]/60 px-6 py-3.5 text-sm font-medium backdrop-blur transition-colors hover:surface"
            >
              How it works
            </Link>
          </div>
        </motion.div>

        {/* Live proof-of-life strip: real TVL, real movers, no placeholders. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.62, ease: [0.16, 1, 0.3, 1] }}
          className="mt-14 grid gap-px overflow-hidden rounded-2xl border hairline bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="bg-[var(--bg)]/80 p-5 backdrop-blur">
            <div className="eyebrow">Onchain value</div>
            <div className="tnum mt-2 text-2xl font-medium">
              <Counter value={tvl} format={(n) => compactUsd(n)} />
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">supply × live mark</div>
          </div>
          <div className="bg-[var(--bg)]/80 p-5 backdrop-blur">
            <div className="eyebrow">Listed assets</div>
            <div className="tnum mt-2 text-2xl font-medium">
              <Counter value={data?.totals.assets ?? 0} format={(n) => Math.round(n).toString()} />
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">B20 equities on Base</div>
          </div>
          {movers.map((m) => (
            <Link key={m.symbol} href={`/markets/${m.ticker.toLowerCase()}`} className="group bg-[var(--bg)]/80 p-5 backdrop-blur transition-colors hover:bg-[var(--bg)]">
              <div className="flex items-center justify-between">
                <div className="eyebrow">{m.ticker}</div>
                <Sparkline data={m.history.slice(-24)} color={m.change >= 0 ? "var(--color-up)" : "var(--color-down)"} width={58} height={20} fill={false} />
              </div>
              <div className="tnum mt-2 text-2xl font-medium">${m.price.toFixed(2)}</div>
              <div className={`tnum mt-1 text-[11px] ${m.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {m.change >= 0 ? "▲" : "▼"} {Math.abs(m.change).toFixed(2)}% · {m.changeWindowHours}h
              </div>
            </Link>
          ))}
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2, duration: 0.8 }}
        className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2"
      >
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          Scroll to explore
          <motion.span animate={{ y: [0, 5, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}>↓</motion.span>
        </div>
      </motion.div>
    </section>
  );
}
