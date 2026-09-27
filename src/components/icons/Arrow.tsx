"use client";

/**
 * The arrow on a call to action.
 *
 * Every one of these was a typographic glyph — → and ← and ↓ — which is the
 * fastest way to put an arrow on a page and the reason they all looked
 * borrowed. A font's arrow is drawn to sit with lowercase text at a body
 * weight; next to a button's medium-weight label at 14px it reads thin,
 * misaligned and slightly too small, and no amount of CSS fixes a shape you
 * do not control.
 *
 * This one is drawn: a shaft that meets the head cleanly, a stroke weight
 * that matches the label beside it, round caps to sit with the type. On
 * hover, inside a `group`, the shaft extends and the whole mark shifts — the
 * head stays put and the arrow stretches toward where it is going, which is
 * the thing a link is promising.
 */
export function Arrow({
  dir = "right", className = "",
}: {
  dir?: "right" | "left" | "down";
  className?: string;
}) {
  const rotate = dir === "left" ? 180 : dir === "down" ? 90 : 0;
  return (
    <svg
      viewBox="0 0 22 12"
      aria-hidden
      className={`inline-block h-[0.72em] w-auto shrink-0 overflow-visible ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* The shaft grows on hover; the head is where it always was. */}
      <path
        d="M1 6h17"
        className="origin-right transition-transform duration-300 ease-out group-hover:scale-x-110"
      />
      <path d="M15.4 1.8 20 6l-4.6 4.2" />
    </svg>
  );
}
