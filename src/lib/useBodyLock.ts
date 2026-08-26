"use client";

import { useEffect } from "react";

/**
 * Locks the page behind an overlay.
 *
 * As well as stopping the scroll, this marks the body so CSS can pause the
 * continuously animating things behind it — the ticker marquee and the live
 * dots. On a phone those keep repainting under the overlay for no visible
 * benefit, and anything compositing above them pays for it every frame.
 */
export function useBodyLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.body.classList.add("overlay-open");
    return () => {
      document.body.style.overflow = overflow;
      document.body.classList.remove("overlay-open");
    };
  }, [active]);
}
