/** Brand indigo. Kept as a literal so the mark renders identically everywhere,
 *  including inside generated share images where CSS variables do not resolve. */
export const BRAND = "#6247F5";

/**
 * The CAPX mark: four bars rising, the last one leaving the others behind —
 * capital in motion, drawn as the thing it measures.
 *
 * The lean is what makes it a movement rather than a chart: every bar shears
 * to the right, so the whole group reads as travelling even standing still.
 * The dark bars take currentColor and invert with the theme; the leader keeps
 * the brand indigo in both, because it is the part that means something.
 */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="CAPX">
      <g fill="currentColor">
        <path d="M9 50h8l2.6-12h-8z" />
        <path d="M21 50h8l2.6-19.9h-8z" />
        <path d="M33 50h8l2.6-27.7h-8z" />
        <rect x="7" y="52.6" width="50" height="4.6" />
      </g>
      <path d="M45 50h8l2.6-37.1h-8z" fill={BRAND} />
    </svg>
  );
}

/** The brand line. A name, not copy — it stays in English in Swahili too. */
export const TAGLINE = "Capital in Motion";

export function Wordmark({
  className = "", underline = false, tagline = false,
}: { className?: string; underline?: boolean; tagline?: boolean }) {
  return (
    <span className={`inline-block ${className}`}>
      <span className="block font-[family-name:var(--font-display)] text-[1.35rem] font-semibold leading-none tracking-[-0.045em]">
        CAPX
      </span>
      {tagline && (
        <span className="mt-[3px] block whitespace-nowrap text-[9.5px] font-medium leading-none tracking-[0.02em] text-[var(--muted)]">
          {TAGLINE}
        </span>
      )}
      {underline && (
        <span className="mt-[0.28em] block h-[0.07em] w-full rounded-full" style={{ background: BRAND }} />
      )}
    </span>
  );
}

/** Full lockup with the tagline, for the footer and share surfaces. */
export function Lockup({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2.5">
        <Logo className="h-8 w-8" />
        <Wordmark className="text-2xl" underline />
      </div>
      <p className="eyebrow mt-3">{TAGLINE}</p>
    </div>
  );
}
