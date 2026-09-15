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
 * It listens on `pointerdown` so the tap lands with the finger rather than
 * after whatever the button does, which is what makes it read as feedback
 * rather than as a result.
 */
export function Haptics() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // Touch and pen only. A mouse click has never wanted a buzz, and on a
      // laptop with a touchscreen the vibration would come from the desk.
      if (e.pointerType === "mouse") return;

      const el = (e.target as Element | null)?.closest?.(
        'button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], label[for]',
      );
      if (!el) return;
      // A disabled control does nothing, so it should not feel like it did.
      if (el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return;

      // Something that commits — placing an order, confirming, signing out —
      // gets a firmer tap than something that merely navigates.
      const weighty = el.matches('button[type="submit"]')
        || /\b(bg-\[var\(--fg\)\]|bg-\[var\(--color-down\)\])/.test(el.className || "");
      haptic(weighty ? "medium" : "light");
    };

    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  return null;
}
