"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";

/** Eases toward a live value, so a polled update animates rather than snapping. */
export function Counter({
  value, format, duration = 1400, className = "",
}: { value: number; format: (n: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: "-10%" });
  const reduced = useReducedMotion();
  const [failsafe, setFailsafe] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setFailsafe(true), 1400);
    return () => clearTimeout(id);
  }, []);
  const inView = seen || failsafe;
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const started = useRef(false);

  useEffect(() => {
    if (!inView || reduced) return;
    const start = performance.now();
    const a = started.current ? from.current : 0;
    started.current = true;
    // First reveal gets the full count-up; later polls just glide to the new value.
    const d = a === 0 ? duration : Math.min(duration, 600);
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / d);
      const eased = 1 - Math.pow(1 - t, 4);
      const v = a + (value - a) * eased;
      setShown(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, inView, duration, reduced]);

  // Reduced motion skips the animation entirely rather than animating to a stop.
  return <span ref={ref} className={className}>{format(reduced ? value : shown)}</span>;
}
