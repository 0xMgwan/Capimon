/** Brand indigo. Kept as a literal so the mark renders identically everywhere,
 *  including inside generated share images where CSS variables do not resolve. */
export const BRAND = "#6247F5";

/**
 * The CAPIMON mark: an open counter with an arrow leaving it — capital in
 * motion. The arc uses butt caps so the opening reads as a deliberate gap
 * rather than a rounded gesture.
 */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="CAPIMON">
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

/** The counter glyph that stands in for the O inside the wordmark. */
function OGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <path d="M45 13.6A21 21 0 1 0 45 50.4" fill="none" stroke="currentColor" strokeWidth="9.5" />
      <path d="M40 20.5 60 32 40 43.5Z" fill={BRAND} />
    </svg>
  );
}

export function Wordmark({
  className = "", underline = false,
}: { className?: string; underline?: boolean }) {
  return (
    <span className={`inline-block ${className}`}>
      <span className="flex items-center font-[family-name:var(--font-display)] text-[1.35rem] font-semibold leading-none tracking-[-0.045em]">
        CAPIM
        {/* Sized in em so the glyph tracks the surrounding type at any scale. */}
        <OGlyph className="mx-[0.02em] h-[0.78em] w-[0.78em]" />
        N
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
