"use client";

import { useEffect, useState } from "react";

/**
 * The Dar es Salaam board.
 *
 * Kept apart from the Chainlink strip above it rather than merged in. Those are
 * dollars on a feed that updates through the session; these are shillings on a
 * single daily print. Sharing one marquee would make each look like the other,
 * and a reader has no way to tell which convention a given row follows.
 */

type Quote = {
  symbol: string; name: string; price: number; close: number; live: number | null;
  change: number; changePct: number; volume: number; tradeDate: string;
};
type Board = {
  ok: boolean; lastTradeDate: string | null; ageDays: number | null;
  live: boolean; quotes: Quote[];
};

const tzs = new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 });

export function DseTape() {
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/dse/board")
        .then((r) => r.json())
        .then((d: Board) => { if (alive) setBoard(d); })
        .catch(() => { /* the strip stays on its last good board */ });
    load();
    // DSE prints once a day; polling harder would only add load for no news.
    const id = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const rows = board?.quotes ?? [];
  if (board && board.ok && rows.length === 0) return null;
  const loop = rows.length ? [...rows, ...rows] : [];

  /*
   * The label says which numbers these are.
   *
   * "Live" while a session is running, and otherwise the age of the print on
   * screen — a figure from Friday shown on a Monday morning should say so
   * rather than sitting there looking current.
   */
  const age = board?.ageDays;
  const label =
    board?.live ? "DSE · live"
    : age === null || age === undefined ? "DSE"
    : age === 0 ? "DSE · today"
    : age === 1 ? "DSE · yesterday"
    : `DSE · ${age}d ago`;

  return (
    <div className="border-b hairline bg-[var(--bg)] md:bg-[var(--bg)]/95 md:backdrop-blur-xl">
      <div className="flex items-center">
        <div className="flex shrink-0 items-center gap-2 border-r hairline px-3 py-1.5 sm:px-4 sm:py-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${
            board?.live ? "live-dot bg-[var(--color-up)]" : "bg-[var(--color-muted)]"}`} />
          <span className="eyebrow hidden sm:inline">{label}</span>
          <span className="eyebrow sm:hidden">DSE</span>
        </div>

        <div className="marquee relative flex-1 overflow-hidden">
          {loop.length === 0 ? (
            <div className="flex gap-8 px-4 py-1.5 sm:py-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-3 w-24 animate-pulse rounded surface" />
              ))}
            </div>
          ) : (
            <div
              className="marquee-track flex w-max gap-7 py-1.5 sm:py-2"
              style={{ "--marquee-duration": "75s" } as React.CSSProperties}
            >
              {loop.map((q, i) => {
                const up = q.changePct >= 0;
                return (
                  <span
                    key={`${q.symbol}-${i}`}
                    className="flex items-center gap-2 whitespace-nowrap rounded px-1 text-xs"
                    title={`${q.name}: close ${tzs.format(q.price)} TZS on ${q.tradeDate}`}
                  >
                    <span className="font-semibold tracking-tight">{q.symbol}</span>
                    <span className="tnum">{tzs.format(q.price)}</span>
                    <span className="text-[10px] text-[var(--muted)]">TZS</span>
                    <span
                      className={`tnum text-[11px] ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}
                    >
                      {up ? "▲" : "▼"} {Math.abs(q.changePct).toFixed(2)}%
                    </span>
                  </span>
                );
              })}
            </div>
          )}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[var(--bg)] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[var(--bg)] to-transparent" />
        </div>
      </div>
    </div>
  );
}
