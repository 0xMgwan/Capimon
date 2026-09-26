"use client";

import { useEffect } from "react";

/**
 * Pins the bottom safe-area inset to a value that does not move.
 *
 * `env(safe-area-inset-bottom)` looks like a property of the device and is
 * really a property of the moment. Under viewport-fit=cover, iOS reports 0
 * while Safari's toolbar covers that strip and about 34px once it collapses,
 * and it interpolates between the two as the toolbar animates — which is on
 * every scroll start and every scroll stop. Anything padded with it grows and
 * shrinks by 34px while you scroll, and the bottom navigation looked like it
 * was sliding around. Its box was never moving; the padding inside it was.
 *
 * The largest value seen is the honest one: it is the room the home indicator
 * actually needs, and a bar padded for it is never overlapped. It is written
 * once, settles within a second of load, and is only re-measured on rotation,
 * which is the one time the real inset legitimately changes.
 */
export function SafeArea() {
  useEffect(() => {
    // A probe rather than getComputedStyle on the bar: env() is only
    // resolvable where it is used, and this element exists to use it.
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:-9999px;bottom:0;width:1px;height:env(safe-area-inset-bottom);pointer-events:none";
    document.body.appendChild(probe);

    let seen = 0;
    const measure = () => {
      // Clamped: a value outside this range is a browser being creative, and
      // padding a navigation bar by it would be worse than ignoring it.
      const h = Math.min(60, Math.max(0, probe.offsetHeight));
      if (h > seen) {
        seen = h;
        document.documentElement.style.setProperty("--safe-b", `${h}px`);
      }
    };

    measure();
    /*
     * A short watch, not a permanent listener.
     *
     * The inset only reveals its full value once the toolbar has collapsed,
     * which needs a scroll — so the first second or so of the session is
     * spent looking. After that the answer cannot improve, and a scroll
     * handler that runs forever to learn nothing is worse than none.
     */
    const id = window.setInterval(measure, 250);
    const stop = window.setTimeout(() => window.clearInterval(id), 3000);

    // Rotation genuinely changes it, and is the only thing that does.
    const onRotate = () => {
      seen = 0;
      document.documentElement.style.removeProperty("--safe-b");
      window.setTimeout(measure, 300);
    };
    window.addEventListener("orientationchange", onRotate);

    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
      window.removeEventListener("orientationchange", onRotate);
      probe.remove();
    };
  }, []);

  return null;
}
