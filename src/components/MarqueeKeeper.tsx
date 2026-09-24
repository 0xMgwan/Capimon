"use client";

import { useEffect } from "react";

/**
 * Keeps the ticker moving across a phone's idea of a day.
 *
 * Two things stop it, and neither announces itself. iOS suspends CSS
 * animations while an app is backgrounded, and a `linear infinite` animation
 * that has been suspended for hours does not reliably pick up where it left
 * off — it can come back paused, or mid-frame and never repaint. And a
 * composited layer that has been promoted for the whole session sometimes
 * comes back from the background blank, which is the version where the strip
 * is still there, still animating, and shows nothing.
 *
 * Both are cured by restarting the animation when the page is looked at
 * again: clear it, force a reflow so the browser cannot coalesce the two
 * writes, and let the class reapply it. Cheap, and it happens at the moment
 * nobody is reading the strip anyway.
 *
 * Mounted once, in the layout: it fixes every marquee on the page rather than
 * each of them having to remember to fix itself.
 */
export function MarqueeKeeper() {
  useEffect(() => {
    const revive = () => {
      if (document.visibilityState !== "visible") return;
      for (const el of document.querySelectorAll<HTMLElement>(".marquee-track")) {
        /*
         * Rebuilt, not just restarted.
         *
         * Restarting the animation fixes a clock that stopped. It does
         * nothing for the other failure, which is the one that shows in an
         * installed app: the layer comes back from suspension blank, still
         * animating, painting nothing. Taking the element out of the layout
         * for a frame forces the layer to be discarded and drawn again,
         * which is the only thing that reliably brings the content back.
         *
         * One frame, at the moment the app is being looked at again, so the
         * flicker has nothing to flicker against.
         */
        el.style.display = "none";
        void el.offsetHeight;
        el.style.display = "";

        el.style.animation = "none";
        // Read a layout property so the removal is flushed before the restore;
        // without it both writes land in the same frame and nothing restarts.
        void el.offsetWidth;
        el.style.animation = "";
      }
    };

    /*
     * And a watchdog, because the events are not the whole story.
     *
     * A restored animation can report itself "running" while its clock never
     * advances — the state the strip is in when it is on screen, has content,
     * and simply does not move. No event fires for that, so it is caught by
     * looking: sample the animation's own time every few seconds and restart
     * anything that has not moved since the last look. Only while the page is
     * visible, so a backgrounded phone is not woken up to check.
     */
    let last: number | null = null;
    const watch = window.setInterval(() => {
      if (document.visibilityState !== "visible") { last = null; return; }
      const track = document.querySelector<HTMLElement>(".marquee-track");
      const anim = track?.getAnimations?.()[0];
      if (!anim) return;
      const now = typeof anim.currentTime === "number" ? anim.currentTime : null;
      if (now !== null && last !== null && now === last) revive();
      last = now;
    }, 8_000);

    document.addEventListener("visibilitychange", revive);
    // Coming back from the back/forward cache, where the page was never
    // unloaded and no other event fires.
    window.addEventListener("pageshow", revive);
    /*
     * An installed app resuming.
     *
     * A home-screen app is suspended and restored rather than reloaded, and
     * which events it fires on the way back is not consistent — focus is the
     * one that arrives every time. Reviving twice costs a frame; not reviving
     * leaves an empty strip where the prices should be.
     */
    window.addEventListener("focus", revive);
    // A rotation or a keyboard closing re-lays-out the strip; a blanked layer
    // usually repaints here too.
    window.addEventListener("orientationchange", revive);

    return () => {
      window.clearInterval(watch);
      document.removeEventListener("visibilitychange", revive);
      window.removeEventListener("pageshow", revive);
      window.removeEventListener("focus", revive);
      window.removeEventListener("orientationchange", revive);
    };
  }, []);

  return null;
}
