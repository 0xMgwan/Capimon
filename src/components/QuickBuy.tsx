"use client";

import Link from "next/link";
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
import { useDse } from "@/lib/useDse";
import { DseLogo } from "./DseLogo";
import { useT } from "@/lib/i18n";

const PRESETS = [50, 100, 500, 1000];
const PRESETS_TZS = [25_000, 100_000, 250_000, 500_000];
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
  const [picked, setPicked] = useState<string | null>(null);
  /** The DSE share the ticket is on, or null when it is on a US name. */
  const [dsePick, setDsePick] = useState<string | null>("CRDB");
  const dseList = useDse();
  const dse = dsePick ? dseList.find((d) => d.symbol === dsePick) ?? null : null;
  const isCrdb = !!dsePick;
  const canShowTzs = !!rate && rate > 0;
  /*
   * A DSE share used to force shillings, because shillings were the only way
   * to buy one. Since the ticket can deliver to a wallet against USDC, that
   * is no longer true — so the toggle applies here too, and the choice is
   * carried through to the panel rather than reset on arrival.
   */
  const inTzs = currency === "TZS" && !!rate && rate > 0;
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
  const crdbUnits = dse && dse.price > 0
    ? Math.floor(
        // In shillings the mark is the price. In dollars it is the mark
        // through the same rate the panel will use, so the two agree.
        ((inTzs ? amount : rate && rate > 0 ? amount / rate : 0) * (1 - dse.feeBps / 10_000)) / dse.price * 1e8,
      ) / 1e8
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
    if (dsePick) {
      const pay = inTzs ? "" : "&pay=usdc";
      router.push(`/markets/${dsePick.toLowerCase()}?side=buy&amount=${inTzs ? Math.round(amount) : amount}${pay}`);
      return;
    }
    if (!selected) return;
    router.push(`/markets/${selected.ticker.toLowerCase()}?side=buy&amount=${amountUsd}`);
  };

  return (
            <div className="rounded-3xl border hairline bg-[var(--bg)]/70 p-3.5 shadow-sm backdrop-blur-sm sm:p-5">
              {/* 1 — size */}
              <div className="flex items-center justify-between gap-2">
                <div className="eyebrow flex items-center gap-1.5">
                  {inTzs ? <NtzsIcon className="h-3.5 w-3.5" /> : <UsdcIcon className="h-3.5 w-3.5" />}
                  {t("You pay")} · {inTzs ? "TZS" : "USDC"}
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
              <div className="mt-2.5 flex items-center gap-3 rounded-2xl border hairline px-4 py-2.5 focus-within:border-[var(--color-accent)] sm:mt-3 sm:py-3.5">
                <span className="text-xl text-[var(--muted)] sm:text-2xl">{inTzs ? "TSh" : "$"}</span>
                <input
                  value={custom || String(amount)}
                  onChange={(e) => onCustom(e.target.value)}
                  inputMode="decimal"
                  aria-label={inTzs ? "Amount in shillings" : "Amount in USDC"}
                  className="tnum w-full bg-transparent text-xl outline-none sm:text-2xl"
                />
                {inTzs ? <NtzsIcon className="h-6 w-6 shrink-0" /> : <UsdcIcon className="h-6 w-6 shrink-0" />}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5 sm:mt-2.5 sm:gap-2">
                {(inTzs ? PRESETS_TZS : PRESETS).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={`tnum rounded-full border py-1.5 text-[13px] font-medium transition-all active:scale-95 sm:py-2 ${
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
              <div className="eyebrow mt-4 sm:mt-6">{t("Buy")}</div>
              <div className="mt-2 sm:mt-3">
                <AssetPicker
                  markets={markets} venues={venues} selected={selected ?? markets[0]}
                  onSelect={(tk) => {
                    // Leaving CRDB for a dollar name: if shillings cannot be
                    // priced, fall back to the currency the swap quotes in.
                    if (isCrdb && !canShowTzs) { setCurrency("USDC"); setCustom(""); setAmount(PRESETS[1]); }
                    setDsePick(null);
                    setPicked(tk);
                  }}
                  dseSelected={dsePick}
                  onSelectDse={(sym) => {
                    if (currency !== "TZS") { setCurrency("TZS"); setCustom(""); setAmount(PRESETS_TZS[1]); }
                    setDsePick(sym);
                  }}
                />
              </div>

              {/* 3 — receipt */}
              <div className="mt-3 rounded-2xl surface p-3 sm:mt-4 sm:p-4">
                <div className="eyebrow">{t("You receive")} · {t("oracle-implied")}</div>
                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={`${dsePick ?? selected?.ticker}-${units.toFixed(6)}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                    className={`tnum mt-1 flex items-center gap-2.5 text-2xl font-medium tracking-tight sm:mt-1.5 sm:text-3xl ${
                      tick === "up" ? "flash-up" : tick === "down" ? "flash-down" : ""
                    }`}
                  >
                    {isCrdb
                      ? <DseLogo logo={dse?.logo ?? (dsePick === "CRDB" ? "/crdb.jpg" : null)} symbol={dsePick ?? ""} size={28} />
                      : selected && <AssetLogo logo={selected.logo} ticker={selected.ticker} color={selected.color} size={28} />}
                    {units.toLocaleString("en-US", { maximumFractionDigits: isCrdb ? 4 : 6, minimumFractionDigits: isCrdb ? 0 : 6 })}
                    <span className="text-sm text-[var(--muted)]">{dsePick ? `${dsePick}t` : selected?.symbol ?? "—"}</span>
                  </motion.div>
                </AnimatePresence>
                <div className="tnum mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                  {isCrdb ? (
                    <>
                      {inTzs
                        ? `TSh ${tzsFmt.format(amount)}`
                        : `${usd(amount)} ≈ TSh ${tzsFmt.format(rate && rate > 0 ? amount / rate : 0)}`}
                      {" "}at {dse && dse.price > 0 ? `TSh ${tzsFmt.format(dse.price)}` : "—"}
                      {dse && dse.feeBps > 0 ? ` · ${dse.feeBps / 100}% ${t("fee")}` : ""} ·{" "}
                      {/* Where it lands, which is what the currency decides. */}
                      {inTzs ? t("settles same day in nTZS") : t("sent to your own wallet")}
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
                disabled={isCrdb ? !dse : !selected}
                className="group mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] sm:mt-4 sm:py-3.5 transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
              >
                {t("Review")} {dsePick ?? selected?.ticker ?? ""} {t("order")}
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </button>

              {/* The long version of this lived here and nobody read it. The
                  asset page gives a real executable quote; this line only has
                  to say that this one is not. */}
              <p className="mt-2 text-[11px] text-[var(--muted)] sm:mt-3">
                {t("Indicative. Real quote on the")}{" "}
                <Link href={dsePick ? `/markets/${dsePick.toLowerCase()}` : selected ? `/markets/${selected.ticker.toLowerCase()}` : "/markets"} className="underline underline-offset-2 hover:text-[var(--fg)]">
                  {t("asset page")}
                </Link>.
              </p>
            </div>
  );
}
