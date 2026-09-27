"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useMarkets } from "@/lib/useMarkets";
import { haptic } from "@/lib/haptics";

/**
 * Pull down to refresh, because the browser's own version is gone.
 *
 * `overscroll-behavior-y: none` is what stopped the page rubber-banding and
 * dragging the fixed tab bar with it. It also disables the pull-to-refresh
 * that came free — so the gesture every phone user has, on the one screen
 * where a number might be stale, quietly stopped working. This puts it back
 * on our own terms.
 *
 * What it refreshes is the data, not the document. `location.reload()` would
 * throw away the whole app to re-read a balance, which on a slow connection
 * is the opposite of what somebody impatient is asking for. It re-runs the
 * fetches the page is already built on and tells everything else through an
 * event.
 *
 * Only from the very top, only on a real downward drag, and never while the
 * page is already scrolling — a gesture that fires when somebody is flicking
 * back up a long list is worse than no gesture.
 */
const TRIGGER_PX = 72;
const MAX_PULL = 110;

/*
 * How far below the top the mark sits when it first appears.
 *
 * Pinned at zero it emerged from behind the sticky header — the ticker and
 * the nav are up there, so the one thing the gesture has to show for itself
 * spent the first half of the pull hidden underneath them. It starts clear of
 * the header and travels from there.
 */
const REST_OFFSET = 64;

export function PullToRefresh() {
  const router = useRouter();
  const { refresh: refreshAccount } = useCapimonAccount();
  const { refresh: refreshMarkets } = useMarkets();

  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      // Only when there is nothing above: mid-list this gesture belongs to
      // the scroller.
      if (window.scrollY > 0 || busy) { startY.current = null; return; }
      startY.current = e.touches[0]?.clientY ?? null;
      armed.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      // An upward drag is a scroll, and a sideways one belongs to a carousel.
      if (dy <= 0) { setPull(0); return; }
      if (window.scrollY > 0) { startY.current = null; setPull(0); return; }

      // Resisted, so it feels attached to something rather than free.
      const eased = Math.min(MAX_PULL, dy * 0.45);
      setPull(eased);
      /*
       * Armed, but not felt yet.
       *
       * The tap belongs here — "let go now" is the thing worth feeling — and
       * it cannot be delivered here. Both mechanisms need user activation:
       * `navigator.vibrate` is blocked without it on Android, and the iOS
       * switch-control haptic plays only inside a `click`. `touchmove` grants
       * neither, so a haptic fired from this handler is silently dropped on
       * every phone, which is exactly what happened.
       *
       * `touchend` does grant activation, so the feedback moves there. The
       * threshold still matters — it decides what is felt on release and
       * whether anything refreshes — it just no longer pretends to buzz.
       */
      if (eased >= TRIGGER_PX && !armed.current) {
        armed.current = true;
      } else if (eased < TRIGGER_PX * 0.8 && armed.current) {
        armed.current = false;
      }
    };

    const onEnd = () => {
      const shouldRun = armed.current;
      const wasPulling = startY.current !== null;
      startY.current = null;
      armed.current = false;

      /*
       * Felt here, synchronously, because this is the only moment that can.
       *
       * `touchend` is an activation-triggering event, so both mechanisms are
       * available for the length of this handler and no longer. Anything
       * awaited first — the refresh, a timeout — has already lost it, which
       * is why this fires before the work rather than after it.
       *
       * A pull that fell short gets nothing: feedback for "that did not
       * count" is worse than silence, because the hand already knows.
       */
      if (!shouldRun) {
        if (wasPulling) setPull(0);
        return;
      }
      haptic("medium", { gesture: true });

      setBusy(true);
      setPull(TRIGGER_PX * 0.6);
      void (async () => {
        try {
          /*
           * Everything the page could be showing, in parallel. The event is
           * for the screens with their own fetches — activity, deposits, the
           * onchain book — which subscribe rather than being wired in here.
           */
          window.dispatchEvent(new CustomEvent("capx:refresh"));
          await Promise.allSettled([
            Promise.resolve(refreshAccount()),
            Promise.resolve(refreshMarkets()),
          ]);
          router.refresh();
          /*
           * Only where it can still be felt.
           *
           * By now the gesture's activation has expired, so the iOS switch
           * plays nothing. Android's vibrate keeps working, and a device that
           * can buzz on completion should — it is the difference between
           * "refreshing" and "refreshed". The call is simply a no-op
           * everywhere else rather than a promise that is not kept.
           */
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            haptic("success", { gesture: true });
          }
        } finally {
          // A beat, so a refresh that returns instantly still reads as having
          // happened rather than as a flicker.
          setTimeout(() => { setBusy(false); setPull(0); }, 350);
        }
      })();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [busy, refreshAccount, refreshMarkets, router]);

  if (pull <= 0 && !busy) return null;

  const progress = Math.min(1, pull / TRIGGER_PX);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center md:hidden"
      style={{
        transform: `translateY(${REST_OFFSET + pull * 0.55}px)`,
        transition: busy ? "transform 220ms ease-out" : "none",
        opacity: Math.min(1, 0.25 + progress),
      }}
    >
      {/*
        * The wordmark, filling up.
        *
        * A circular arrow is the icon every app uses for this, which is
        * precisely why it says nothing about this one — and it had the same
        * problem as the green dot it replaced. CAPX is three rising bars, so
        * the bars rise as the page is pulled: at rest they are stubs, at the
        * trigger point they are the logo, and while it works they run. The
        * gesture is the mark drawing itself.
        */}
      <span className="grid h-9 w-9 place-items-center rounded-full border hairline bg-[var(--bg)] shadow-lg shadow-black/10">
        <span className="flex h-[13px] items-end gap-[2.5px]">
          {[0, 1, 2].map((i) => {
            const full = [58, 100, 76][i];
            // Each bar fills in turn, so the mark builds left to right
            // instead of three things growing at once.
            const share = Math.max(0, Math.min(1, progress * 3 - i));
            return (
              <span
                key={i}
                className={`w-[2.5px] rounded-full bg-[var(--fg)] ${busy ? "live-bar" : ""}`}
                style={{
                  height: `${full}%`,
                  transformOrigin: "bottom",
                  transform: busy ? undefined : `scaleY(${0.18 + share * 0.82})`,
                  animationDelay: busy ? `${i * 0.28}s` : undefined,
                  transition: "transform 90ms linear",
                }}
              />
            );
          })}
        </span>
      </span>
    </div>
  );
}
