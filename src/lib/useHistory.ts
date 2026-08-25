"use client";

import { useEffect, useState } from "react";

export type Activity = {
  kind: "buy" | "sell" | "receive" | "send";
  symbol: string; ticker: string; qty: number; usdc: number | null;
  price: number; value: number; priceSource: "fill" | "oracle"; ts: number; tx: string;
};

export type Position = {
  symbol: string; ticker: string; name: string; color: string; logo: string | null;
  qty: number; avgCost: number | null; costBasis: number; marketValue: number;
  unrealised: number; unrealisedPct: number | null; realised: number; price: number;
};

export type WalletHistory = {
  ok: boolean; complete: boolean; missedRanges: number; totalRanges: number;
  positions: Position[]; activity: Activity[];
  totals: { marketValue: number; costBasis: number; unrealised: number; realised: number };
  error?: string;
};

/**
 * Cost basis is rebuilt from Transfer logs, which is slow on a rate-limited
 * public RPC. It loads on its own so the rest of the portfolio renders first.
 */
export function useHistory(address?: string) {
  // Tie the result to the wallet it came from, so switching wallets shows a
  // loading state rather than the previous wallet's basis.
  const [fetched, setFetched] = useState<{ address: string; data: WalletHistory } | null>(null);
  const data = fetched && fetched.address === address ? fetched.data : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/history?address=${address}`, { cache: "no-store" });
        const j: WalletHistory = await r.json();
        if (!alive) return;
        if (!j.ok) throw new Error(j.error ?? "could not rebuild history");
        setFetched({ address, data: j });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "could not rebuild history");
      } finally {
        if (alive) setLoading(false);
      }
    };
    const first = setTimeout(load, 0);
    const id = setInterval(load, 120_000);
    return () => { alive = false; clearTimeout(first); clearInterval(id); };
  }, [address]);

  return { data, loading, error };
}

/** Client-side CSV of every disposal and acquisition, for tax workings. */
export function activityCsv(activity: Activity[]) {
  const head = ["date", "type", "ticker", "quantity", "unit_price_usd", "value_usd", "price_source", "tx_hash"];
  const rows = activity.map((a) => [
    new Date(a.ts * 1000).toISOString(),
    a.kind,
    a.ticker,
    a.qty.toFixed(8),
    a.price.toFixed(6),
    a.value.toFixed(6),
    a.priceSource,
    a.tx,
  ]);
  return [head, ...rows].map((r) => r.join(",")).join("\n");
}
