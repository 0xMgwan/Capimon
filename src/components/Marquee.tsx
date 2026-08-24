"use client";

export function Marquee({
  items, duration = 38, className = "",
}: { items: React.ReactNode[]; duration?: number; className?: string }) {
  const loop = [...items, ...items];
  return (
    <div className={`marquee relative overflow-hidden ${className}`}>
      <div className="marquee-track flex w-max items-center gap-14" style={{ "--marquee-duration": `${duration}s` } as React.CSSProperties}>
        {loop.map((it, i) => (
          <div key={i} className="shrink-0 opacity-45 transition-opacity duration-300 hover:opacity-100">{it}</div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[var(--bg)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[var(--bg)] to-transparent" />
    </div>
  );
}
