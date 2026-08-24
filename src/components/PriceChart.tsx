"use client";

import { useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/useMarkets";
import { usd } from "@/lib/format";

const RANGES = [
  { key: "1D", hours: 24 },
  { key: "1W", hours: 24 * 7 },
  { key: "1M", hours: 24 * 30 },
  { key: "ALL", hours: Infinity },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

/**
 * Interactive price chart over real Chainlink round data. Every point is an
 * onchain print — there is no interpolation or synthetic fill.
 */
export function PriceChart({ data, color, height = 320 }: { data: Candle[]; color: string; height?: number }) {
  const [range, setRange] = useState<RangeKey>("ALL");
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 1000;

  const series = useMemo(() => {
    const hrs = RANGES.find((r) => r.key === range)!.hours;
    if (!Number.isFinite(hrs) || data.length === 0) return data;
    // Windows are measured from the most recent onchain print, not the wall
    // clock — these feeds run 24/5 and freeze through corporate actions, so
    // "the last 24h of trading" is the honest reading of a 1D range.
    const cutoff = data[data.length - 1].t - hrs * 3600;
    const win = data.filter((d) => d.t >= cutoff);
    return win.length >= 2 ? win : data;
  }, [data, range]);

  const geo = useMemo(() => {
    if (series.length < 2) return null;
    const ps = series.map((d) => d.p);
    const min = Math.min(...ps);
    const max = Math.max(...ps);
    const span = max - min || max * 0.01 || 1;
    const padY = 26;
    const x = (i: number) => (i / (series.length - 1)) * W;
    const y = (p: number) => height - padY - ((p - min) / span) * (height - padY * 2);
    return {
      min, max, x, y,
      line: ps.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(" "),
      area: `${ps.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(" ")} L${W},${height} L0,${height} Z`,
      up: ps[ps.length - 1] >= ps[0],
    };
  }, [series, height]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!geo || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const rel = ((e.clientX - box.left) / box.width) * (series.length - 1);
    const i = Math.max(0, Math.min(series.length - 1, Math.round(rel)));
    setHover({ i, x: geo.x(i), y: geo.y(series[i].p) });
  };

  const change = series.length > 1 ? ((series[series.length - 1].p - series[0].p) / series[0].p) * 100 : 0;
  const shown = hover ? series[hover.i] : series[series.length - 1];

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="tnum text-3xl font-medium tracking-tight sm:text-4xl">
            {shown ? usd(shown.p) : "—"}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className={`tnum ${change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% · {range}
            </span>
            {hover && (
              <span className="tnum text-[var(--muted)]">
                {new Date(shown.t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-1 rounded-full border hairline p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                range === r.key ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      <div className="relative rounded-2xl border hairline p-1">
        {!geo ? (
          <div className="grid place-items-center text-sm text-[var(--muted)]" style={{ height }}>
            Waiting for the first onchain rounds…
          </div>
        ) : (
          <svg
            ref={ref}
            viewBox={`0 0 ${W} ${height}`}
            className="w-full cursor-crosshair"
            style={{ height }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.20" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1="0" x2={W} y1={height * f} y2={height * f}
                stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
            ))}

            <path d={geo.area} fill="url(#pc-fill)" />
            <path d={geo.line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="sweep" style={{ "--len": 6000 } as React.CSSProperties} />

            {hover && (
              <g>
                <line x1={hover.x} x2={hover.x} y1="0" y2={height} stroke="var(--border)" strokeWidth="1" />
                <circle cx={hover.x} cy={hover.y} r="5" fill="var(--bg)" stroke={color} strokeWidth="2.5" />
              </g>
            )}
            <circle cx={geo.x(series.length - 1)} cy={geo.y(series[series.length - 1].p)} r="4" fill={color} />
          </svg>
        )}

        {geo && (
          <>
            <span className="tnum pointer-events-none absolute right-3 top-2 text-[10px] text-[var(--muted)]">{usd(geo.max)}</span>
            <span className="tnum pointer-events-none absolute bottom-2 right-3 text-[10px] text-[var(--muted)]">{usd(geo.min)}</span>
          </>
        )}
      </div>

      <p className="mt-2 text-[11px] text-[var(--muted)]">
        {series.length} onchain price rounds · Chainlink total-return feed on Base · 24/5, frozen through corporate actions
      </p>
    </div>
  );
}
