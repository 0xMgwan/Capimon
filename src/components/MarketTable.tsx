"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMarkets } from "@/lib/useMarkets";
import { useVenues } from "@/lib/useVenues";
import { Sparkline } from "./Sparkline";
import { AssetLogo } from "./AssetLogo";
import { compact, compactUsd, ago } from "@/lib/format";

type SortKey = "ticker" | "price" | "change" | "tvl" | "supply";

export function MarketTable({ limit, showSearch = true }: { limit?: number; showSearch?: boolean }) {
  const { data, ticks, loading, error } = useMarkets();
  const { venues } = useVenues();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("tvl");
  const [dir, setDir] = useState<1 | -1>(-1);

  const rows = useMemo(() => {
    let r = data?.markets ?? [];
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      r = r.filter((m) => m.ticker.toLowerCase().includes(s) || m.name.toLowerCase().includes(s) || m.sector.toLowerCase().includes(s));
    }
    r = [...r].sort((a, b) => {
      const va = sort === "ticker" ? a.ticker : (a[sort] as number);
      const vb = sort === "ticker" ? b.ticker : (b[sort] as number);
      if (typeof va === "string") return va.localeCompare(vb as string) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return limit ? r.slice(0, limit) : r;
  }, [data, q, sort, dir, limit]);

  const th = (key: SortKey, label: string, align = "right") => (
    <th
      className={`cursor-pointer select-none px-3 py-3 text-${align} text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] transition-colors hover:text-[var(--fg)]`}
      onClick={() => { if (sort === key) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(key); setDir(key === "ticker" ? 1 : -1); } }}
    >
      {label}
      <span className="ml-1 inline-block w-2 opacity-60">{sort === key ? (dir === 1 ? "↑" : "↓") : ""}</span>
    </th>
  );

  return (
    <div>
      {showSearch && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search ticker, company or sector"
              className="w-full rounded-full border hairline bg-transparent py-2.5 pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--color-accent)]"
            />
          </div>
          <div className="tnum text-xs text-[var(--muted)]">
            {error ? <span className="text-[var(--color-down)]">{error}</span>
              : data ? `${rows.length} markets · updated ${ago(data.asOf)}` : "connecting to Base…"}
          </div>
        </div>
      )}

      {/* Phones get cards; the table needs more width than a phone has. */}
      <div className="grid grid-cols-1 gap-2 md:hidden">
        {loading && !rows.length &&
          Array.from({ length: limit ?? 6 }).map((_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-2xl surface" />
          ))}
        {rows.map((m) => {
          const dirTick = ticks[m.symbol];
          const up = m.change >= 0;
          const v = venues[m.symbol];
          return (
            <Link
              key={m.symbol}
              href={`/markets/${m.ticker.toLowerCase()}`}
              className="block min-w-0 rounded-2xl border hairline p-4 transition-colors active:surface"
            >
              <div className="flex items-center gap-3">
                <AssetLogo logo={m.logo} ticker={m.ticker} color={m.color} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-medium tracking-tight">{m.ticker}</span>
                    {v && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        v.tradeable
                          ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
                          : "surface text-[var(--muted)]"
                      }`}>
                        {v.tradeable ? "Tradeable" : "Mint only"}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-[var(--muted)]">{m.name}</span>
                </span>
                <Sparkline data={m.history.slice(-30)} color={up ? "var(--color-up)" : "var(--color-down)"} width={56} height={26} />
                <span className="shrink-0 text-right">
                  <span className={`tnum block text-[15px] ${dirTick === "up" ? "flash-up" : dirTick === "down" ? "flash-down" : ""}`}>
                    ${m.price.toFixed(2)}
                  </span>
                  <span className={`tnum block text-xs ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                    {up ? "+" : ""}{m.change.toFixed(2)}%
                  </span>
                </span>
              </div>
              {m.tvl > 0 && (
                <div className="tnum mt-3 flex justify-between border-t hairline pt-2.5 text-[11px] text-[var(--muted)]">
                  <span>{compact(m.supply, 2)} share-equivalents</span>
                  <span>{compactUsd(m.tvl)} onchain</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>

      <div className="scroll-thin hidden overflow-x-auto rounded-2xl border hairline md:block">
        <table className="w-full min-w-[760px] border-collapse">
          <thead className="border-b hairline">
            <tr>
              {th("ticker", "Asset", "left")}
              {th("price", "Price")}
              {th("change", "Change")}
              <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">Trend</th>
              {th("supply", "Onchain supply")}
              {th("tvl", "Onchain value")}
              <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">Trade</th>
              <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">Feed</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length &&
              Array.from({ length: limit ?? 8 }).map((_, i) => (
                <tr key={i} className="border-b hairline last:border-0">
                  <td colSpan={8} className="px-3 py-4"><div className="h-5 w-full animate-pulse rounded surface" /></td>
                </tr>
              ))}

            {rows.map((m) => {
              const dirTick = ticks[m.symbol];
              const up = m.change >= 0;
              return (
                <tr key={m.symbol} className="group border-b hairline transition-colors last:border-0 hover:surface">
                  <td className="px-3 py-3.5">
                    <Link href={`/markets/${m.ticker.toLowerCase()}`} className="flex items-center gap-3">
                      <AssetLogo logo={m.logo} ticker={m.ticker} color={m.color} size={36} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium tracking-tight">{m.ticker}</span>
                        <span className="block truncate text-xs text-[var(--muted)]">{m.name}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={`tnum px-3 py-3.5 text-right text-sm ${dirTick === "up" ? "flash-up" : dirTick === "down" ? "flash-down" : ""}`}>
                    ${m.price.toFixed(2)}
                  </td>
                  <td className={`tnum px-3 py-3.5 text-right text-sm ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                    {up ? "+" : ""}{m.change.toFixed(2)}%
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex justify-end">
                      <Sparkline data={m.history.slice(-40)} color={up ? "var(--color-up)" : "var(--color-down)"} width={92} height={28} />
                    </div>
                  </td>
                  <td className="tnum px-3 py-3.5 text-right text-sm">
                    {m.supply > 0 ? compact(m.supply, 2) : <span className="text-[var(--muted)]">—</span>}
                  </td>
                  <td className="tnum px-3 py-3.5 text-right text-sm">
                    {m.tvl > 0 ? compactUsd(m.tvl) : <span className="text-[var(--muted)]">—</span>}
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    {(() => {
                      const v = venues[m.symbol];
                      if (!v) return <span className="text-[11px] text-[var(--muted)]">—</span>;
                      return v.tradeable ? (
                        <span
                          title={v.venues.join(" + ")}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-up)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--color-up)]"
                        >
                          Tradeable
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full surface px-2.5 py-1 text-[11px] text-[var(--muted)]">
                          Mint only
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    <span className={`tnum inline-flex items-center gap-1.5 text-[11px] ${m.stale ? "text-[var(--muted)]" : "text-[var(--color-up)]"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${m.stale ? "bg-[var(--color-muted)]" : "live-dot bg-[var(--color-up)]"}`} />
                      {m.updatedAt ? ago(m.updatedAt) : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
