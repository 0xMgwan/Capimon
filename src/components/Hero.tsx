"use client";

import Link from "next/link";
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useMarkets } from "@/lib/useMarkets";
import { Counter } from "./Counter";
import { RevealWords } from "./Reveal";
import { compactUsd } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import { AssetLogo } from "./AssetLogo";

/** True when the backdrop should hold still: reduced motion, or a phone. */
function useStillBackdrop() {
  const reduced = useReducedMotion();
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setSmall(mq.matches);
    const raf = requestAnimationFrame(apply);
    mq.addEventListener("change", apply);
    return () => { cancelAnimationFrame(raf); mq.removeEventListener("change", apply); };
  }, []);
  return reduced || small;
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const still = useStillBackdrop();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "22%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.12]);

  const { data } = useMarkets();
  // Longest history available, so the curve has shape rather than a flat line.
  const backdrop = (data?.markets ?? [])
    .filter((m) => m.history.length > 8)
    .sort((a, b) => b.history.length - a.history.length)[0];
  const tvl = data?.totals.tvl ?? 0;
  const movers = [...(data?.markets ?? [])].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 2);

  return (
    <section ref={ref} className="relative isolate flex min-h-[76vh] flex-col justify-center overflow-hidden [@supports(height:100dvh)]:min-h-[76dvh] sm:min-h-[88vh] sm:[@supports(height:100dvh)]:min-h-[88dvh]">
      {/* Living mesh backdrop — cheap, GPU-only, and it never blocks the type. */}
      <motion.div style={reduced ? undefined : { scale }} className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[var(--bg)]" />
        <motion.div
          animate={still ? undefined : { x: [0, 60, -30, 0], y: [0, -40, 30, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -left-[10%] top-[6%] h-[46vw] w-[46vw] rounded-full blur-[100px]"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--color-accent) 42%, transparent), transparent 70%)" }}
        />
        <motion.div
          animate={still ? undefined : { x: [0, -70, 40, 0], y: [0, 50, -20, 0] }}
          transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -right-[8%] top-[26%] h-[40vw] w-[40vw] rounded-full blur-[110px]"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, #34d1bf 34%, transparent), transparent 70%)" }}
        />
        <motion.div
          animate={still ? undefined : { x: [0, 40, -50, 0], y: [0, -30, 40, 0] }}
          transition={{ duration: 38, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-[2%] left-[26%] h-[36vw] w-[36vw] rounded-full blur-[110px]"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, #ffb86b 30%, transparent), transparent 70%)" }}
        />
        {/*
          The hero's backdrop is the product's own data rather than decoration:
          a real price curve, faint enough never to compete with the type.
        */}
        {backdrop && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 opacity-[0.10]
                       [&>svg]:h-[38vh] [&>svg]:w-full"
            /* The svg carries a viewBox, so overriding its width lets the curve
               span whatever the screen is instead of being drawn at a fixed
               1400px and cut off on a phone. */
          >
            <Sparkline
              data={backdrop.history}
              color="var(--color-accent)"
              width={1400}
              height={320}
              strokeWidth={2}
            />
          </div>
        )}
        <div className="grain absolute inset-0 mix-blend-overlay" />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg)]/10 via-transparent to-[var(--bg)]" />
      </motion.div>

      <motion.div style={reduced ? undefined : { y, opacity }} className="mx-auto w-full max-w-[1400px] px-5 pb-10 pt-10 sm:px-8 sm:pb-16 sm:pt-20">
        <h1 className="display text-center text-[clamp(2.4rem,9vw,8.5rem)] sm:text-left">
          <RevealWords text="Own the open" />
          <br />
          <span className="italic font-[family-name:var(--font-serif)] font-light tracking-[-0.02em]">
            <RevealWords text="market." delay={0.16} />
          </span>
        </h1>

        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="mt-7 flex flex-col gap-7 sm:mt-8 sm:gap-8 lg:flex-row lg:items-end lg:justify-between"
        >
          <p className="mx-auto max-w-xl text-center font-[family-name:var(--font-serif)] text-[17px] leading-relaxed text-[var(--muted)] sm:mx-0 sm:text-left sm:text-xl">
            CAPX puts public equities onchain. Live oracle marks,
            real onchain supply, permissionless secondary transfer, and self-custody —
            no broker, no closing bell for settlement.
          </p>

          <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <Link
              href="/markets"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-[var(--fg)] px-6 py-4 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03] active:scale-95 sm:py-3.5"
            >
              Explore markets
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
            <Link
              href="/how-it-works"
              className="rounded-full border hairline bg-[var(--bg)] px-6 py-4 text-center text-sm font-medium sm:bg-[var(--bg)]/60 sm:backdrop-blur transition-colors hover:surface sm:py-3.5"
            >
              How it works
            </Link>
          </div>
        </motion.div>

        {/* Live proof-of-life strip: real TVL, real movers, no placeholders. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.62, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border hairline bg-[var(--border)] sm:mt-14 lg:grid-cols-4"
        >
          <div className="bg-[var(--bg)] p-4 sm:bg-[var(--bg)]/80 sm:p-5 sm:backdrop-blur">
            <div className="eyebrow">Onchain value</div>
            <div className="tnum mt-2 text-xl font-medium sm:text-2xl">
              <Counter value={tvl} format={(n) => compactUsd(n)} />
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">supply × live mark</div>
          </div>
          <div className="bg-[var(--bg)] p-4 sm:bg-[var(--bg)]/80 sm:p-5 sm:backdrop-blur">
            <div className="eyebrow">Listed assets</div>
            <div className="tnum mt-2 text-xl font-medium sm:text-2xl">
              <Counter value={data?.totals.assets ?? 0} format={(n) => Math.round(n).toString()} />
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">tokenized equities</div>
          </div>
          {movers.map((m) => (
            <Link key={m.symbol} href={`/markets/${m.ticker.toLowerCase()}`} className="group bg-[var(--bg)] p-4 transition-colors hover:bg-[var(--bg)] sm:bg-[var(--bg)]/80 sm:p-5 sm:backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <AssetLogo logo={m.logo} ticker={m.ticker} color={m.color} size={14} />
                  <span className="eyebrow truncate">{m.ticker}</span>
                </div>
                <Sparkline data={m.history.slice(-24)} color={m.change >= 0 ? "var(--color-up)" : "var(--color-down)"} width={44} height={18} fill={false} />
              </div>
              <div className="tnum mt-2 text-xl font-medium sm:text-2xl">${m.price.toFixed(2)}</div>
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
