/** Brand indigo. Kept as a literal so the mark renders identically everywhere,
 *  including inside generated share images where CSS variables do not resolve. */
export const BRAND = "#6247F5";

/**
 * The CAPX mark: an open counter with an arrow leaving it — capital in
 * motion. The arc uses butt caps so the opening reads as a deliberate gap
 * rather than a rounded gesture.
 */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="CAPX">
      <path
        d="M43 12.95A22 22 0 1 0 43 51.05"
        fill="none"
        stroke="currentColor"
        strokeWidth="9.5"
      />
      <path d="M22 27.6H44V19l17 13-17 13v-8.6H22Z" fill={BRAND} />
    </svg>
  );
}

export function Wordmark({
  className = "", underline = false,
}: { className?: string; underline?: boolean }) {
  return (
    <span className={`inline-block ${className}`}>
      <span className="block font-[family-name:var(--font-display)] text-[1.35rem] font-semibold leading-none tracking-[-0.045em]">
        CAPX
      </span>
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
      <p className="eyebrow mt-3">Capital markets in motion</p>
    </div>
  );
}
