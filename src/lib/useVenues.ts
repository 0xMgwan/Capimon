"use client";

import { useEffect, useState } from "react";

export type Venue = { symbol: string; tradeable: boolean; venues: string[]; spread: number | null };

/**
 * Which assets are routable right now. Probing every asset is expensive, so it
 * refreshes far more slowly than prices do.
 */
export function useVenues() {
  const [map, setMap] = useState<Record<string, Venue>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/venues", { cache: "no-store" });
        const j = await r.json();
        if (!alive || !j.ok) return;
        setMap(Object.fromEntries((j.venues as Venue[]).map((v) => [v.symbol, v])));
      } catch {
        /* the table just falls back to no badge */
      } finally {
        if (alive) setLoaded(true);
      }
    };
    const first = setTimeout(load, 0);
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearTimeout(first); clearInterval(id); };
  }, []);

  return { venues: map, loaded };
}
