"use client";

import Link from "next/link";
import { useMarkets } from "@/lib/useMarkets";
import { AssetLogo } from "./AssetLogo";
import { marketSession } from "@/lib/format";
import { useEffect, useState } from "react";

/** Always-on strip of live Chainlink marks, doubled so the marquee loops seamlessly. */
export function TickerTape() {
  const { data, ticks } = useMarkets();
  const [session, setSession] = useState(() => marketSession());

  useEffect(() => {
    const id = setInterval(() => setSession(marketSession()), 30_000);
    return () => clearInterval(id);
  }, []);

  const rows = data?.markets ?? [];
  const loop = rows.length ? [...rows, ...rows] : [];

  return (
    <div className="border-b hairline bg-[var(--bg)] md:bg-[var(--bg)]/95 md:backdrop-blur-xl">
      <div className="flex items-center">
        <div className="flex shrink-0 items-center gap-2 border-r hairline px-3 py-2 sm:px-4">
          <span
            className={`live-dot inline-block h-1.5 w-1.5 rounded-full ${session.open ? "bg-[var(--color-up)]" : "bg-[var(--color-muted)]"}`}
          />
          <span className="eyebrow hidden sm:inline">{session.label}</span>
          <span className="eyebrow sm:hidden">{session.open ? "Open" : "Closed"}</span>
        </div>

        <div className="marquee relative flex-1 overflow-hidden">
          {loop.length === 0 ? (
            <div className="flex gap-8 px-4 py-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-3 w-24 animate-pulse rounded surface" />
              ))}
            </div>
          ) : (
            <div className="marquee-track flex w-max gap-7 py-2" style={{ "--marquee-duration": "60s" } as React.CSSProperties}>
              {loop.map((m, i) => {
                const dir = ticks[m.symbol];
                const up = m.change >= 0;
                return (
                  <Link
                    key={`${m.symbol}-${i}`}
                    href={`/markets/${m.ticker.toLowerCase()}`}
                    className={`flex items-center gap-2 whitespace-nowrap rounded px-1 text-xs transition-opacity hover:opacity-60 ${
                      dir === "up" ? "flash-up" : dir === "down" ? "flash-down" : ""
                    }`}
                  >
                    <AssetLogo logo={m.logo} ticker={m.ticker} color={m.color} size={14} />
                    <span className="font-semibold tracking-tight">{m.ticker}</span>
                    <span className="tnum">${m.price.toFixed(2)}</span>
                    <span className={`tnum text-[11px] ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                      {up ? "▲" : "▼"} {Math.abs(m.change).toFixed(2)}%
                    </span>
                  </Link>
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
