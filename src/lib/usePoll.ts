"use client";

import { useEffect, useRef } from "react";

/**
 * A repeating refresh that stops while nobody is looking.
 *
 * Every poll in this app was a plain interval, so a tab left open in the
 * background went on asking for a balance nobody could see — overnight, that
 * is a few thousand requests to show a number to an empty room. The timer
 * still ticks; what it does not do is fetch.
 *
 * Coming back is the other half. A tab returned to after an hour should not
 * show an hour-old balance until the next tick comes round, so becoming
 * visible refreshes immediately — which is also the moment the reader
 * actually wants the number.
 */
export function usePoll(fn: () => void, ms: number, enabled = true) {
  // Kept in a ref so a caller can pass a fresh closure every render without
  // tearing down and rebuilding the timer each time.
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });

  useEffect(() => {
    if (!enabled) return;

    const run = () => { if (document.visibilityState === "visible") latest.current(); };
    const id = window.setInterval(run, ms);
    const onVisible = () => { if (document.visibilityState === "visible") latest.current(); };

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, enabled]);
}

/**
 * The same idea for effects that already have their own cleanup to do.
 *
 * Returns the stop function, so an existing `return () => { … }` gains one
 * call rather than being restructured around a hook.
 */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const run = () => { if (document.visibilityState === "visible") fn(); };
  const id = window.setInterval(run, ms);
  // Returning to a tab refreshes at once: the moment somebody looks is the
  // moment a stale number matters.
  document.addEventListener("visibilitychange", run);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", run);
  };
}
