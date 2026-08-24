export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="capimon-g" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="var(--color-accent-soft)" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="none" stroke="url(#capimon-g)" strokeWidth="1.6" />
      {/* Capital in motion — an ascending track, contained. */}
      <path d="M9 21 L14 14 L18.5 18 L23.5 10.5" fill="none" stroke="url(#capimon-g)"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23.5" cy="10.5" r="2.1" fill="var(--color-accent)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-[family-name:var(--font-display)] text-[1.35rem] font-medium tracking-[-0.055em] ${className}`}>
      CAPIMON
    </span>
  );
}

/** Full lockup with the tagline, for the footer and share surfaces. */
export function Lockup({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2.5">
        <Logo className="h-8 w-8" />
        <Wordmark className="text-2xl" />
      </div>
      <p className="eyebrow mt-2">Capital markets in motion</p>
    </div>
  );
}
