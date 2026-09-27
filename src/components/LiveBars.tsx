"use client";

/**
 * The "this is live" mark.
 *
 * It was a small green circle, which is what every dashboard on the internet
 * uses and therefore says nothing about this one. Worse, it is a status light
 * — the visual language of a server being up — attached to a claim about a
 * market being open.
 *
 * This is three bars that rise and fall. It is the wordmark: CAPX is drawn as
 * rising bars and called Capital in Motion, so the thing that signals life
 * may as well be the logo doing the one thing the name promises. It reads as
 * a market at a glance rather than as an indicator, and at this size it is
 * legible as movement before it is legible as shape.
 *
 * Slow and shallow on purpose. A market tape that jitters is a market in
 * trouble; this breathes. Somebody who has asked for less motion gets three
 * static bars at different heights, which still reads as a small chart.
 */
export function LiveBars({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-[11px] items-end gap-[2px] ${className}`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="live-bar w-[2px] rounded-full bg-[var(--color-up)]"
          style={{ animationDelay: `${i * 0.28}s`, height: `${[55, 100, 75][i]}%` }}
        />
      ))}
    </span>
  );
}
