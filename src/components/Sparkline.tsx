"use client";

import { useId } from "react";
import type { Candle } from "@/lib/useMarkets";

/** Compact price trace built from live Chainlink rounds. */
export function Sparkline({
  data, color, width = 120, height = 34, strokeWidth = 1.5, fill = true, animate = false,
}: {
  data: Candle[]; color: string; width?: number; height?: number;
  strokeWidth?: number; fill?: boolean; animate?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  if (data.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3" />
      </svg>
    );
  }

  const ps = data.map((d) => d.p);
  const min = Math.min(...ps);
  const max = Math.max(...ps);
  const span = max - min || max * 0.01 || 1;
  const pad = strokeWidth;
  const x = (i: number) => (i / (data.length - 1)) * (width - pad * 2) + pad;
  const y = (p: number) => height - pad - ((p - min) / span) * (height - pad * 2);

  const line = ps.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(" ");
  const area = `${line} L${x(ps.length - 1).toFixed(2)},${height} L${x(0).toFixed(2)},${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      {fill && (
        <>
          <defs>
            <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#sg-${id})`} />
        </>
      )}
      <path
        d={line} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeLinejoin="round"
        className={animate ? "sweep" : undefined}
        style={animate ? ({ "--len": 2000 } as React.CSSProperties) : undefined}
      />
      <circle cx={x(ps.length - 1)} cy={y(ps[ps.length - 1])} r={strokeWidth + 0.8} fill={color} />
    </svg>
  );
}
