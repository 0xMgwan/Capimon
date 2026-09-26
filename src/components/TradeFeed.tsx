"use client";

import { useEffect, useState } from "react";
import { pollWhileVisible } from "@/lib/usePoll";
import { useT } from "@/lib/i18n";

/**
 * One line saying the market is alive.
 *
 * A page of prices with no sign of anybody using them reads as a market
 * nobody trades, which for a young exchange is both untrue and
 * self-fulfilling. This is the smallest honest answer to that: somebody
 * bought something, a few minutes ago.
 *
 * Deliberately one line and deliberately still. A feed that scrolled, or
 * flashed, or asked to be clicked would be competing with the thing the page
 * is for — trades are the decoration here and the prices are the content, so
 * it changes once every several seconds, fades rather than moves, and never
 * takes a tap.
 *
 * No names. Whose trade it was is only ever shown where its owner has
 * published it, and that is a different decision made somewhere else.
 */
type Trade = { side: "buy" | "sell"; symbol: string; qty: number; at: string };

const ago = (iso: string, t: (s: string) => string) => {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return t("just now");
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${t("ago")}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${t("ago")}`;
  return `${Math.floor(hrs / 24)}d ${t("ago")}`;
};

const qty = (n: number) => (n >= 1 ? n.toFixed(2) : n.toFixed(4));

export function TradeFeed() {
  const { t } = useT();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/activity", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (alive && j.ok) setTrades(j.trades ?? []); })
        .catch(() => { /* the strip simply stays as it was */ });
    };
    load();
    const stop = pollWhileVisible(load, 45_000);
    return () => { alive = false; stop(); };
  }, []);

  // Moves on its own, slowly. Anything faster reads as an alert.
  useEffect(() => {
    if (trades.length < 2) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setI((n) => (n + 1) % trades.length);
    }, 5_000);
    return () => window.clearInterval(id);
  }, [trades.length]);

  if (!trades.length) return null;
  const trade = trades[i % trades.length];

  return (
    <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
          trade.side === "buy" ? "bg-[var(--color-up)]" : "bg-[var(--color-down)]"
        }`}
      />
      {/*
        * Keyed on the trade so React swaps the node and the fade replays.
        * Without the key the text would change inside a settled element and
        * the line would jump rather than dissolve.
        */}
      {/*
        * Whole phrases, not words glued together.
        *
        * "Someone" + "bought" reads in English and falls apart in Swahili,
        * where the verb carries the subject — and "bought" already means
        * something else elsewhere in the dictionary.
        */}
      <span key={`${trade.at}-${i}`} className="min-w-0 truncate fade-in">
        <span className="text-[var(--fg)]">
          {t(trade.side === "buy" ? "Someone bought" : "Someone sold")} {qty(trade.qty)} {trade.symbol}
        </span>{" "}
        · {ago(trade.at, t)}
      </span>
    </div>
  );
}
