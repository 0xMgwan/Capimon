/** nTZS brand mark — the Tanzanian shilling stablecoin. */
export function NtzsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="#1B4A72" />
      <circle cx="32" cy="32" r="24.5" fill="none" stroke="#ffffff" strokeWidth="2.6" opacity="0.9" />
      {/* Two interlocking arcs reading as an N, in the brand's rounded style. */}
      <path
        d="M23.5 42V26.5a5.5 5.5 0 0 1 9.6-3.6l7.4 8.3a5.5 5.5 0 0 0 9.6-3.6"
        fill="none" stroke="#ffffff" strokeWidth="5.4" strokeLinecap="round"
      />
      <path
        d="M40.5 22v15.5a5.5 5.5 0 0 1-9.6 3.6l-7.4-8.3a5.5 5.5 0 0 0-9.6 3.6"
        fill="none" stroke="#ffffff" strokeWidth="5.4" strokeLinecap="round"
      />
    </svg>
  );
}
