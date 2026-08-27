"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import type { Market } from "@/lib/useMarkets";
import type { Venue } from "@/lib/useVenues";
import { AssetLogo } from "./AssetLogo";
import { Sparkline } from "./Sparkline";
import { usd } from "@/lib/format";
import { useBodyLock } from "@/lib/useBodyLock";

/**
 * Company selector for the order ticket. A popover on desktop, a bottom sheet
 * on phones — both over the same searchable list, so picking an asset never
 * takes the user away from the amount they just chose.
 */
export function AssetPicker({
  markets, venues, selected, onSelect, trigger,
}: {
  markets: Market[];
  venues: Record<string, Venue>;
  selected?: Market;
  onSelect: (ticker: string) => void;
  /**
   * Custom opener. Without it the picker draws its own select-style button,
   * which suits a ticket; a caller that already has a button of its own — "Buy
   * shares" on the portfolio — supplies one so the same list can open from it
   * rather than sending the user off to the markets index.
   */
  trigger?: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // useSyncExternalStore is the sanctioned way to read "are we on the client"
  // without setting state from an effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useBodyLock(open);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = s
      ? markets.filter((m) =>
          m.ticker.toLowerCase().includes(s) || m.name.toLowerCase().includes(s) || m.sector.toLowerCase().includes(s))
      : markets;
    // Routable first — the point of the ticket is to buy something.
    return [...filtered].sort(
      (a, b) => Number(!!venues[b.symbol]?.tradeable) - Number(!!venues[a.symbol]?.tradeable) || b.tvl - a.tvl,
    );
  }, [markets, venues, q]);

  const list = (
    <div className="scroll-thin max-h-[52vh] overflow-y-auto overscroll-contain p-1.5">
      {rows.length === 0 && (
        <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">No company matches “{q}”.</p>
      )}
      {rows.map((m) => {
        const v = venues[m.symbol];
        const active = selected?.symbol === m.symbol;
        return (
          <button
            key={m.symbol}
            onClick={() => { onSelect(m.ticker); setOpen(false); }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
              active ? "surface" : "hover:surface"
            }`}
          >
            <AssetLogo logo={m.logo} ticker={m.ticker} color={m.color} size={34} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{m.ticker}</span>
                {v && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    v.tradeable ? "bg-[var(--color-up)]/10 text-[var(--color-up)]" : "surface text-[var(--muted)]"
                  }`}>
                    {v.tradeable ? "Tradeable" : "Mint only"}
                  </span>
                )}
              </span>
              <span className="block truncate text-[11px] text-[var(--muted)]">{m.name}</span>
            </span>
            <Sparkline data={m.history.slice(-20)} color={m.change >= 0 ? "var(--color-up)" : "var(--color-down)"} width={40} height={18} fill={false} />
            <span className="shrink-0 text-right">
              <span className="tnum block text-sm">{usd(m.price)}</span>
              <span className={`tnum block text-[11px] ${m.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {m.change >= 0 ? "+" : ""}{m.change.toFixed(2)}%
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const search = (
    <div className="border-b hairline p-2">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search company or ticker"
        className="w-full rounded-xl bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-[var(--muted)]"
      />
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      {trigger ? trigger(() => { setQ(""); setOpen(true); }) : (
      <button
        onClick={() => { setQ(""); setOpen((o) => !o); }}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl border hairline px-4 py-3 text-left transition-colors hover:border-[var(--color-accent)]"
      >
        {selected ? (
          <>
            <AssetLogo logo={selected.logo} ticker={selected.ticker} color={selected.color} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium leading-tight">{selected.ticker}</span>
              <span className="block truncate text-xs text-[var(--muted)]">{selected.name}</span>
            </span>
            <span className="tnum shrink-0 text-right">
              <span className="block text-[15px]">{usd(selected.price)}</span>
              <span className={`block text-[11px] ${selected.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {selected.change >= 0 ? "+" : ""}{selected.change.toFixed(2)}%
              </span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-[var(--muted)]">Loading companies…</span>
        )}
        <motion.svg
          viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[var(--muted)]" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          <path d="m6 9 6 6 6-6" />
        </motion.svg>
      </button>
      )}

      <AnimatePresence>
        {open && (
          <>
            {/* Desktop popover */}
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.99 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-x-0 top-full z-40 mt-2 hidden overflow-hidden rounded-2xl border hairline bg-[var(--bg)] shadow-2xl shadow-black/10 sm:block"
            >
              {search}
              {list}
            </motion.div>

            {/* Phone bottom sheet. Portalled to <body> because the reveal
                animation above creates a stacking context the fixed sheet
                would otherwise be trapped inside, landing it under the tab bar. */}
            {mounted &&
              createPortal(
                <>
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={() => setOpen(false)}
                    className="fixed inset-0 z-[60] bg-black/55 sm:hidden"
                  />
                  <motion.div
                    initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className="safe-b fixed inset-x-0 bottom-0 z-[70] overflow-hidden rounded-t-3xl border-t hairline bg-[var(--bg)] shadow-2xl sm:hidden"
                  >
                    <div className="flex justify-center pt-2.5">
                      <span className="h-1 w-10 rounded-full bg-[var(--border)]" />
                    </div>
                    {search}
                    {list}
                  </motion.div>
                </>,
                document.body,
              )}
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
