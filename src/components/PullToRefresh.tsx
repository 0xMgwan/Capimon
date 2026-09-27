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
      if (eased >= TRIGGER_PX && !armed.current) {
        armed.current = true;
        haptic();
      }
    };

    const onEnd = () => {
      const shouldRun = armed.current;
      startY.current = null;
      armed.current = false;
      if (!shouldRun) { setPull(0); return; }

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
      style={{ transform: `translateY(${Math.max(0, pull - 28)}px)`, transition: busy ? "transform 200ms" : "none" }}
    >
      <span className="grid h-8 w-8 place-items-center rounded-full border hairline bg-[var(--bg)] shadow-lg">
        {/*
          The mark turns as it is pulled and spins once it is working, so the
          gesture has a state rather than only a before and an after.
        */}
        <svg
          viewBox="0 0 24 24" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}
          style={{ transform: busy ? undefined : `rotate(${progress * 270}deg)`, opacity: 0.35 + progress * 0.65 }}
          fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 4v5h-5" />
        </svg>
      </span>
    </div>
  );
}
