"use client";

import { useEffect } from "react";
import { haptic } from "@/lib/haptics";

/**
 * Feedback on every control, from one listener.
 *
 * Delegated rather than wired into each button: there are well over a hundred
 * of them, a prop on each would be forgotten on the next one written, and a
 * control that taps back everywhere except the one place someone added last
 * week feels broken rather than subtle.
 *
 * It listens on whichever event each platform accepts as a real tap (see
 * below), so every control — buttons, links, tabs, toggles, pickers — taps
 * back, including ones written after this.
 */
const CONTROLS = [
  "button", "a[href]", "summary", "select", "label[for]",
  '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="menuitem"]', '[role="option"]',
  'input[type="checkbox"]', 'input[type="radio"]', 'input[type="submit"]', 'input[type="button"]',
].join(", ");

function feelFor(target: EventTarget | null) {
  const el = (target as Element | null)?.closest?.(CONTROLS);
  if (!el) return null;
  // The haptic's own hidden switch lives in <head>; its click must not count
  // as a tap, or every haptic would trigger another.
  if (el.closest("head")) return null;
  // A disabled control does nothing, so it should not feel like it did.
  if (el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return null;
  // Something that commits — placing an order, confirming, signing out — gets
  // a firmer tap than something that merely navigates.
  const weighty = el.matches('button[type="submit"], input[type="submit"]')
    || /\b(bg-\[var\(--fg\)\]|bg-\[var\(--color-down\)\]|bg-\[var\(--color-up\)\])/.test(
      typeof el.className === "string" ? el.className : "");
  return weighty ? "medium" as const : "light" as const;
}

export function Haptics() {
  useEffect(() => {
    /*
     * Which event carries the tap depends on the platform, because each only
     * lets feedback through from an event it counts as a real gesture.
     *
     * iOS: the switch-control haptic plays only inside `click`.
     * Android and other touch browsers: `navigator.vibrate` needs user
     * activation, which touch grants on pointerup — not pointerdown, which is
     * why the first tap after opening the site used to do nothing.
     *
     * Mouse clicks are left alone: a laptop has nothing to vibrate.
     */
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.userAgent.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1);

    const onClick = (e: MouseEvent) => {
      const feel = feelFor(e.target);
      if (feel) haptic(feel);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const feel = feelFor(e.target);
      if (feel) haptic(feel);
    };

    if (ios) document.addEventListener("click", onClick, { capture: true, passive: true });
    else document.addEventListener("pointerup", onUp, { passive: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("pointerup", onUp);
    };
  }, []);

  return null;
}
