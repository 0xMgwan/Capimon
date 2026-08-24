"use client";

import { useState } from "react";

/**
 * Issuer artwork from the B20 contractURI, falling back to a coloured monogram
 * when a token has no image or the fetch fails.
 */
export function AssetLogo({
  logo, ticker, color, size = 36, className = "",
}: { logo?: string | null; ticker: string; color: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const px = `${size}px`;

  if (logo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        decoding="async"
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full bg-white object-contain ring-1 ring-[var(--border)] ${className}`}
        style={{ width: px, height: px }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`}
      style={{ width: px, height: px, background: color, fontSize: Math.max(9, size * 0.3) }}
    >
      {ticker.slice(0, 2)}
    </span>
  );
}
