"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useMarkets } from "@/lib/useMarkets";
import { useVenues } from "@/lib/useVenues";
import { AssetPicker } from "./AssetPicker";
import { AssetLogo } from "./AssetLogo";
import { Reveal, RevealWords } from "./Reveal";
import { UsdcIcon } from "./icons/Usdc";
import { NtzsIcon } from "./icons/Ntzs";
import { usd } from "@/lib/format";

const PRESETS = [50, 100, 500, 1000];
const PRESETS_TZS = [25_000, 100_000, 250_000, 500_000];

/**
 * A single order ticket: how much, what, what you get. The company selector is
 * a picker rather than a second panel, so amount and asset stay one decision
 * instead of reading as two separate tabs.
 */
export function QuickBuy() {
  const { data, ticks } = useMarkets();
  const { venues } = useVenues();
  const router = useRouter();
  const [amount, setAmount] = useState(100);
  /*
   * The ticket prices in USDC because the router does, but a Tanzanian visitor
   * thinks in shillings — and this is the first number they see on the site.
   * The toggle changes what they type; the conversion happens here.
   */
  /*
   * The rate comes from the public endpoint, not from the signed-in account.
   * This ticket is the first thing a visitor sees and they are signed out by
   * definition — reading the account's rate meant the shilling option was
   * hidden from exactly the people it exists for.
   */
  /*
   * Local, not the shared useCurrency hook: that one forces USDC whenever the
   * signed-in account has no shilling rate, which is always true here — this
   * ticket is for logged-out visitors. It would have rendered the toggle and
   * then ignored every press.
   */
  const [currency, setCurrency] = useState<"TZS" | "USDC">("USDC");
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/ntzs/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const out = Number(j?.expectedOutput ?? 0);
        if (alive && j?.ok && out > 0) setRate(out / 100_000);
      })
      .catch(() => { /* the ticket still works in USDC */ });
    return () => { alive = false; };
  }, []);
  const canShowTzs = !!rate && rate > 0;
  const inTzs = currency === "TZS" && !!rate && rate > 0;
  const amountUsd = inTzs && rate ? amount * rate : amount;
  const [custom, setCustom] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const markets = useMemo(() => {
    const rank = (sym: string) => (venues[sym]?.tradeable ? 0 : 1);
    return [...(data?.markets ?? [])].sort(
      (a, b) => rank(a.symbol) - rank(b.symbol) || b.tvl - a.tvl || a.ticker.localeCompare(b.ticker),
    );
  }, [data, venues]);

  const selected = markets.find((m) => m.ticker === picked) ?? markets[0];
  const venue = selected ? venues[selected.symbol] : undefined;
  const units = selected && selected.price > 0 ? amountUsd / selected.price : 0;
  const tick = selected ? ticks[selected.symbol] : undefined;

  const setPreset = (n: number) => { setAmount(n); setCustom(""); };
  const onCustom = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setCustom(clean);
    const n = Number(clean);
    if (n > 0) setAmount(n);
  };

  const go = () => {
    if (!selected) return;
    router.push(`/markets/${selected.ticker.toLowerCase()}?side=buy&amount=${amountUsd}`);
  };

  return (
    <section className="border-y hairline">
      <div className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-20 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[1fr_minmax(380px,460px)] lg:gap-16">
          <Reveal>
            <div className="lg:sticky lg:top-36">
              <div className="eyebrow">Quick buy</div>
              <h2 className="display mt-4 text-[clamp(1.65rem,4.6vw,3.6rem)]">
                <RevealWords text="One ticket." />
                <br />
                <span className="font-[family-name:var(--font-serif)] font-light italic text-[var(--muted)]">
                  <RevealWords text="Thirteen companies." delay={0.1} />
                </span>
              </h2>
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[var(--muted)]">
                Everything settles in USDC on Base. Set a size, pick a company, and CAPX shows the
                live oracle-implied position before you go anywhere near a signature.
              </p>

              <dl className="mt-8 grid max-w-sm grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)]">
                <div className="bg-[var(--bg)] p-4">
                  <dt className="eyebrow">Settles in</dt>
                  <dd className="mt-1.5 flex items-center gap-1.5 text-lg font-medium">
                    <UsdcIcon className="h-4 w-4" /> USDC
                  </dd>
                </div>
                <div className="bg-[var(--bg)] p-4">
                  <dt className="eyebrow">Custody</dt>
                  <dd className="mt-1.5 text-lg font-medium">Yours</dd>
                </div>
              </dl>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="rounded-3xl border hairline p-5 shadow-sm sm:p-6">
              {/* 1 — size */}
              <div className="flex items-center justify-between gap-2">
                <div className="eyebrow flex items-center gap-1.5">
                  {inTzs ? <NtzsIcon className="h-3.5 w-3.5" /> : <UsdcIcon className="h-3.5 w-3.5" />}
                  You pay · {inTzs ? "TZS" : "USDC"}
                </div>
                {canShowTzs && (
                  <div className="flex rounded-full surface p-0.5">
                    {(["TZS", "USDC"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setCurrency(c);
                          setCustom("");
                          setAmount(c === "TZS" ? PRESETS_TZS[1] : PRESETS[1]);
                        }}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                          currency === c ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-2xl border hairline px-4 py-3.5 focus-within:border-[var(--color-accent)]">
                <span className="text-2xl text-[var(--muted)]">{inTzs ? "TSh" : "$"}</span>
                <input
                  value={custom || String(amount)}
                  onChange={(e) => onCustom(e.target.value)}
                  inputMode="decimal"
                  aria-label={inTzs ? "Amount in shillings" : "Amount in USDC"}
                  className="tnum w-full bg-transparent text-2xl outline-none"
                />
                {inTzs ? <NtzsIcon className="h-6 w-6 shrink-0" /> : <UsdcIcon className="h-6 w-6 shrink-0" />}
              </div>
              <div className="mt-2.5 grid grid-cols-4 gap-2">
                {(inTzs ? PRESETS_TZS : PRESETS).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={`tnum rounded-full border py-2 text-[13px] font-medium transition-all active:scale-95 ${
                      amount === p && !custom
                        ? "border-transparent bg-[var(--fg)] text-[var(--bg)]"
                        : "hairline hover:surface"
                    }`}
                  >
                    {inTzs ? `${p / 1000}k` : `$${p >= 1000 ? `${p / 1000}k` : p}`}
                  </button>
                ))}
              </div>

              {/* 2 — company */}
              <div className="eyebrow mt-6">Buy</div>
              <div className="mt-3">
                <AssetPicker markets={markets} venues={venues} selected={selected} onSelect={setPicked} />
              </div>

              {/* 3 — receipt */}
              <div className="mt-4 rounded-2xl surface p-4">
                <div className="eyebrow">You receive · oracle-implied</div>
                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={`${selected?.ticker}-${units.toFixed(6)}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                    className={`tnum mt-1.5 flex items-center gap-2.5 text-3xl font-medium tracking-tight ${
                      tick === "up" ? "flash-up" : tick === "down" ? "flash-down" : ""
                    }`}
                  >
                    {selected && <AssetLogo logo={selected.logo} ticker={selected.ticker} color={selected.color} size={28} />}
                    {units.toFixed(6)}
                    <span className="text-sm text-[var(--muted)]">{selected?.symbol ?? "—"}</span>
                  </motion.div>
                </AnimatePresence>
                <div className="tnum mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                  {usd(amount)} at {selected ? usd(selected.price) : "—"} ·{" "}
                  {venue
                    ? venue.tradeable
                      ? `routing via ${venue.venues.join(" + ")}`
                      : "no secondary market yet — mint only"
                    : "checking routes…"}
                </div>
              </div>

              <button
                onClick={go}
                disabled={!selected}
                className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--fg)] py-4 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
              >
                Review {selected?.ticker ?? ""} order
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </button>

              <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
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
