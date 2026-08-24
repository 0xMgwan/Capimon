"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AssetMeta } from "./assets";

export type Candle = { t: number; p: number; round: string };
export type Market = AssetMeta & {
  logo: string | null;
  price: number; feedDecimals: number; updatedAt: number; roundId: string;
  change: number; changeWindowHours: number; multiplier: number; decimals: number;
  supply: number; rawSupply: number; tvl: number; history: Candle[]; stale: boolean;
};
export type Snapshot = {
  ok: boolean; degraded?: boolean; asOf: number;
  totals: { tvl: number; assets: number; listed: number; lastUpdate: number };
  markets: Market[];
};

type Ctx = {
  data: Snapshot | null;
  /** Per-symbol tick direction, cleared shortly after each move — drives the price flash. */
  ticks: Record<string, "up" | "down" | undefined>;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

const MarketsCtx = createContext<Ctx>({ data: null, ticks: {}, error: null, loading: true, refresh: () => {} });

const POLL_MS = 10_000;

export function MarketsProvider({ children, initial }: { children: React.ReactNode; initial?: Snapshot | null }) {
  const [data, setData] = useState<Snapshot | null>(initial ?? null);
  const [ticks, setTicks] = useState<Record<string, "up" | "down" | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initial);
  const prev = useRef<Record<string, number>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const load = useMemo(
    () => async () => {
      try {
        const r = await fetch("/api/markets", { cache: "no-store" });
        const j: Snapshot & { error?: string } = await r.json();
        if (!j.ok) throw new Error(j.error ?? "feed unavailable");

        const moved: Record<string, "up" | "down"> = {};
        for (const m of j.markets) {
          const p = prev.current[m.symbol];
          if (p !== undefined && m.price !== p) moved[m.symbol] = m.price > p ? "up" : "down";
          prev.current[m.symbol] = m.price;
        }
        setData(j);
        setError(j.degraded ? "Serving last good snapshot — RPC degraded" : null);
        if (Object.keys(moved).length) {
          setTicks((t) => ({ ...t, ...moved }));
          const id = setTimeout(() => {
            setTicks((t) => {
              const next = { ...t };
              for (const k of Object.keys(moved)) delete next[k];
              return next;
            });
          }, 1000);
          timers.current.push(id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "feed unavailable");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    // Polling backs off while the tab is hidden, but the first load always runs —
    // a page opened in a background tab must still have data when it is focused.
    const tick = () => { if (alive && document.visibilityState === "visible") void load(); };
    const first = setTimeout(() => { if (alive) void load(); }, 0);
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    const captured = timers.current;
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      captured.forEach(clearTimeout);
    };
  }, [load]);

  return (
    <MarketsCtx.Provider value={{ data, ticks, error, loading, refresh: load }}>
      {children}
    </MarketsCtx.Provider>
  );
}

export const useMarkets = () => useContext(MarketsCtx);

export function useMarket(symbol: string) {
  const { data, ticks } = useMarkets();
  const key = symbol.toLowerCase();
  const market = data?.markets.find(
    (m) => m.symbol.toLowerCase() === key || m.ticker.toLowerCase() === key,
  );
  return { market, tick: market ? ticks[market.symbol] : undefined };
}
