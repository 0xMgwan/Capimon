"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useMarkets } from "@/lib/useMarkets";
import { useVenues } from "@/lib/useVenues";
import { AssetPicker } from "./AssetPicker";
import { AssetLogo } from "./AssetLogo";
import { UsdcIcon } from "./icons/Usdc";
import { NtzsIcon } from "./icons/Ntzs";
import { usd } from "@/lib/format";
import { useCrdb } from "@/lib/useCrdb";
import { useT } from "@/lib/i18n";

const PRESETS = [50, 100, 500, 1000];
const PRESETS_TZS = [25_000, 100_000, 250_000, 500_000];
/** Sentinel for the CRDB row, which is not a Chainlink market. */
const CRDB = "__CRDB__";
const tzsFmt = new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 });

/**
 * A single order ticket: how much, what, what you get. The company selector is
 * a picker rather than a second panel, so amount and asset stay one decision
 * instead of reading as two separate tabs.
 *
 * It lives in the hero rather than in a section of its own a scroll further
 * down. The wide hero had a headline on the left and nothing beside it, while
 * the one thing a visitor came to do sat below the fold — the empty half was
 * exactly the right size for it.
 */
export function QuickBuy() {
  const { t } = useT();
  const { data, ticks } = useMarkets();
  const { venues } = useVenues();
  const router = useRouter();
  /*
   * Shillings, and 100,000 of them.
   *
   * Almost everyone arriving here earns and thinks in shillings, so opening in
   * dollars asks each of them to do a conversion before the first number means
   * anything. The dollar figure is one press away for the minority who want it.
   * If the rate turns out to be unavailable the effect below falls back, so the
   * ticket still works rather than showing shillings it cannot price.
   */
  const [amount, setAmount] = useState(PRESETS_TZS[1]);
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
  const [currency, setCurrency] = useState<"TZS" | "USDC">("TZS");
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const toUsdc = () => {
      // No rate means shillings cannot be priced, so the ticket drops to the
      // currency it can quote rather than showing a figure it cannot convert.
      // The amount stays in shillings: the ticket opens on CRDB, which is
      // priced in them regardless, and switching to a dollar name resets it.
      if (!alive) return;
      setCurrency("USDC");
    };
    fetch("/api/ntzs/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const out = Number(j?.expectedOutput ?? 0);
        if (!alive) return;
        if (j?.ok && out > 0) setRate(out / 100_000);
        else toUsdc();
      })
      .catch(toUsdc);
    return () => { alive = false; };
  }, []);
  const [custom, setCustom] = useState("");
  /*
   * CRDB first.
   *
   * The site is for Tanzanians buying Tanzanian shares, with US names as the
   * second act. Opening the ticket on NVIDIA said the opposite in the one
   * place every visitor looks.
   */
  const [picked, setPicked] = useState<string | null>(CRDB);
  const crdb = useCrdb();
  const isCrdb = picked === CRDB;
  const canShowTzs = !!rate && rate > 0;
  const inTzs = (currency === "TZS" && !!rate && rate > 0) || picked === CRDB;
  const amountUsd = inTzs && rate ? amount * rate : amount;

  const markets = useMemo(() => {
    const rank = (sym: string) => (venues[sym]?.tradeable ? 0 : 1);
    return [...(data?.markets ?? [])].sort(
      (a, b) => rank(a.symbol) - rank(b.symbol) || b.tvl - a.tvl || a.ticker.localeCompare(b.ticker),
    );
  }, [data, venues]);

  const selected = isCrdb ? undefined : markets.find((m) => m.ticker === picked) ?? markets[0];
  const venue = selected ? venues[selected.symbol] : undefined;
  /* CRDB settles in shillings at the DSE mark, fee off the cash leg and the
     share count floored — the same arithmetic the order itself runs. */
  const crdbUnits = crdb && crdb.price > 0
    ? Math.floor(((amount * (1 - crdb.feeBps / 10_000)) / crdb.price) * 1e8) / 1e8
    : 0;
  const units = isCrdb ? crdbUnits : selected && selected.price > 0 ? amountUsd / selected.price : 0;
  const tick = selected ? ticks[selected.symbol] : undefined;

  const setPreset = (n: number) => { setAmount(n); setCustom(""); };
  const onCustom = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setCustom(clean);
    const n = Number(clean);
    if (n > 0) setAmount(n);
  };

  const go = () => {
    if (isCrdb) { router.push(`/markets/crdb?side=buy&amount=${Math.round(amount)}`); return; }
    if (!selected) return;
    router.push(`/markets/${selected.ticker.toLowerCase()}?side=buy&amount=${amountUsd}`);
  };

  return (
            <div className="rounded-3xl border hairline bg-[var(--bg)]/70 p-4 shadow-sm backdrop-blur-sm sm:p-5">
              {/* 1 — size */}
              <div className="flex items-center justify-between gap-2">
                <div className="eyebrow flex items-center gap-1.5">
                  {inTzs ? <NtzsIcon className="h-3.5 w-3.5" /> : <UsdcIcon className="h-3.5 w-3.5" />}
                  {t("You pay")} · {inTzs ? "TZS" : "USDC"}
                </div>
                {canShowTzs && !isCrdb && (
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
              <div className="eyebrow mt-6">{t("Buy")}</div>
              <div className="mt-3">
                <AssetPicker
                  markets={markets} venues={venues} selected={selected ?? markets[0]}
                  onSelect={(tk) => {
                    // Leaving CRDB for a dollar name: if shillings cannot be
                    // priced, fall back to the currency the swap quotes in.
                    if (isCrdb && !canShowTzs) { setCurrency("USDC"); setCustom(""); setAmount(PRESETS[1]); }
                    setPicked(tk);
                  }}
                  crdbSelected={isCrdb}
                  onSelectCrdb={() => {
                    if (currency !== "TZS") { setCurrency("TZS"); setCustom(""); setAmount(PRESETS_TZS[1]); }
                    setPicked(CRDB);
                  }}
                />
              </div>

              {/* 3 — receipt */}
              <div className="mt-4 rounded-2xl surface p-4">
                <div className="eyebrow">{t("You receive")} · {t("oracle-implied")}</div>
                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={`${isCrdb ? "CRDB" : selected?.ticker}-${units.toFixed(6)}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                    className={`tnum mt-1.5 flex items-center gap-2.5 text-3xl font-medium tracking-tight ${
                      tick === "up" ? "flash-up" : tick === "down" ? "flash-down" : ""
                    }`}
                  >
                    {isCrdb
                      ? <Image src="/crdb.jpg" alt="" width={28} height={28} className="rounded-full object-cover" />
                      : selected && <AssetLogo logo={selected.logo} ticker={selected.ticker} color={selected.color} size={28} />}
                    {units.toLocaleString("en-US", { maximumFractionDigits: isCrdb ? 4 : 6, minimumFractionDigits: isCrdb ? 0 : 6 })}
                    <span className="text-sm text-[var(--muted)]">{isCrdb ? "CRDBt" : selected?.symbol ?? "—"}</span>
                  </motion.div>
                </AnimatePresence>
                <div className="tnum mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                  {isCrdb ? (
                    <>
                      TSh {tzsFmt.format(amount)} at {crdb ? `TSh ${tzsFmt.format(crdb.price)}` : "—"}
                      {crdb && crdb.feeBps > 0 ? ` · ${crdb.feeBps / 100}% ${t("fee")}` : ""} · {t("settles same day in nTZS")}
                    </>
                  ) : (<>
                  {inTzs ? `TSh ${tzsFmt.format(amount)} ≈ ${usd(amountUsd)}` : usd(amount)} at {selected ? usd(selected.price) : "—"} ·{" "}
                  {venue
                    ? venue.tradeable
                      ? `routing via ${venue.venues.join(" + ")}`
                      : "no secondary market yet, mint only"
                    : "checking routes…"}
                  </>)}
                </div>
              </div>

              <button
                onClick={go}
                disabled={isCrdb ? !crdb : !selected}
                className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
              >
                {t("Review")} {isCrdb ? "CRDB" : selected?.ticker ?? ""} {t("order")}
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </button>

              {/* The long version of this lived here and nobody read it. The
                  asset page gives a real executable quote; this line only has
                  to say that this one is not. */}
              <p className="mt-3 text-[11px] text-[var(--muted)]">
                {t("Indicative. Real quote on the")}{" "}
                <Link href={isCrdb ? "/markets/crdb" : selected ? `/markets/${selected.ticker.toLowerCase()}` : "/markets"} className="underline underline-offset-2 hover:text-[var(--fg)]">
                  {t("asset page")}
                </Link>.
              </p>
            </div>
  );
}
