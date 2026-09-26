"use client";

import { useEffect, useState } from "react";
import { pollWhileVisible } from "@/lib/usePoll";
import { ProfileCard } from "./ProfileCard";
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
 * flashed, or demanded attention would be competing with the thing the page
 * is for — the prices are the content and this is the frame around them, so
 * it changes once every several seconds and dissolves rather than moves.
 *
 * Names appear only where their owner published them. That decision is made
 * in the query, not here: an account that has not switched its trading on
 * arrives with no handle at all, and reads as "someone". Tapping a handle
 * that is there opens the same card a comment does.
 */
type Trade = { side: "buy" | "sell"; symbol: string; qty: number; at: string; who: string | null };

const ago = (iso: string, t: (s: string) => string) => {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return t("just now");
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

const qty = (n: number) => (n >= 1 ? n.toFixed(2) : n.toFixed(4));

export function TradeFeed({ symbol }: {
  /** Narrows the feed to one security. Its own page does not need the ticker repeated. */
  symbol?: string;
}) {
  const { t } = useT();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [i, setI] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const url = symbol ? `/api/activity?symbol=${encodeURIComponent(symbol)}` : "/api/activity";
    const load = () => {
      fetch(url, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (alive && j.ok) setTrades(j.trades ?? []); })
        .catch(() => { /* the strip simply stays as it was */ });
    };
    load();
    const stop = pollWhileVisible(load, 45_000);
    return () => { alive = false; stop(); };
  }, [symbol]);

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
  const up = trade.side === "buy";

  return (
    <div className="flex items-center gap-2.5 overflow-hidden rounded-full border hairline py-1.5 pl-2.5 pr-3">
      {/*
        The live indicator. A ring that breathes rather than a dot that
        blinks: a blink is an alert and this is not news, it is weather.
      */}
      <span aria-hidden className="relative flex h-2 w-2 shrink-0">
        <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 pulse-ring ${
          up ? "bg-[var(--color-up)]" : "bg-[var(--color-down)]"}`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${
          up ? "bg-[var(--color-up)]" : "bg-[var(--color-down)]"}`} />
      </span>

      {/*
        Keyed on the trade so React swaps the node and the transition replays.
        Without the key the text would change inside a settled element and the
        line would jump rather than dissolve.
      */}
      <span key={`${trade.at}-${i}`} className="feed-in flex min-w-0 flex-1 items-baseline gap-1.5 text-[12px]">
        {trade.who ? (
          <button
            onClick={() => setViewing(trade.who!)}
            className="shrink-0 font-medium text-[var(--color-accent)] hover:underline"
          >
            @{trade.who}
          </button>
        ) : (
          <span className="shrink-0 text-[var(--muted)]">{t("Someone")}</span>
        )}
        <span className={`shrink-0 font-medium ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
          {t(up ? "has bought" : "has sold")}
        </span>
        <span className="tnum shrink-0 text-[var(--fg)]">{qty(trade.qty)}</span>
        {/* On a security's own page the ticker is already the headline. */}
        {!symbol && (
          <span className="tnum shrink-0 rounded-full surface px-1.5 py-0.5 text-[10.5px] font-medium">
            {trade.symbol}
          </span>
        )}
        <span className="tnum ml-auto shrink-0 pl-2 text-[11px] text-[var(--muted)]">
          {ago(trade.at, t)}
        </span>
      </span>

      {viewing && <ProfileCard username={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
