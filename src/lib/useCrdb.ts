"use client";

import { useEffect, useState } from "react";

/**
 * The CRDB mark, shared by everything that shows it.
 *
 * Three places wanted this figure and two of them were fetching it themselves,
 * which is how the company picker ended up showing "Open →" where every other
 * row showed a price. One hook, one shape, and a component that forgets to
 * render the number is now the only way to be missing it.
 */
export type CrdbSummary = {
  price: number;
  changePct: number;
  tradeDate: string | null;
  availableShares: number;
  tradable: boolean;
};

let cache: CrdbSummary | null = null;

export function useCrdb() {
  // Seeded from the module so a second component mounting does not flash empty
  // while it waits for a request the first one already made.
  const [data, setData] = useState<CrdbSummary | null>(cache);

  useEffect(() => {
    let alive = true;
    fetch("/api/securities/crdb", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) return;
        const next: CrdbSummary = {
          price: j.dse?.price ?? j.market.price,
          changePct: j.dse?.changePct ?? 0,
          tradeDate: j.dse?.tradeDate ?? null,
          availableShares: j.market.availableShares,
          tradable: j.market.tradable,
        };
        cache = next;
        if (alive) setData(next);
      })
      .catch(() => { /* callers fall back to a link without a price */ });
    return () => { alive = false; };
  }, []);

  return data;
}

/** Does a search string mean CRDB? Shared so every search agrees. */
export function matchesCrdb(query: string) {
  const s = query.trim().toLowerCase();
  if (!s) return true;
  return ["crdb", "crdb bank plc", "dar es salaam", "tanzania", "dse", "crdbt"]
    .some((t) => t.includes(s) || s.includes(t));
}
