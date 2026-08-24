"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * Content must never be permanently invisible because an animation did not run.
 * IntersectionObserver drives the reveal, but a timer forces the visible state if
 * the observer is throttled (backgrounded tab, restored scroll position, slow paint).
 */
function useRevealed(ref: React.RefObject<Element | null>, once: boolean) {
  const inView = useInView(ref, { once, margin: "-12% 0px -12% 0px" });
  const [failsafe, setFailsafe] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setFailsafe(true), 1400);
    return () => clearTimeout(id);
  }, []);

  return inView || failsafe;
}

export function Reveal({
  children, delay = 0, y = 26, className = "", once = true,
}: { children: React.ReactNode; delay?: number; y?: number; className?: string; once?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const revealed = useRevealed(ref, once);
  const reduced = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, y }}
      animate={revealed ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Word-by-word rise, used on the big display headlines. */
export function RevealWords({ text, className = "", delay = 0 }: { text: string; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const revealed = useRevealed(ref, true);
  const reduced = useReducedMotion();
  const words = text.split(" ");

  return (
    <span ref={ref} className={className}>
      {words.map((w, i) => (
        // The inter-word space sits outside the clipping wrapper — a trailing
        // space inside an inline-block gets trimmed and the words run together.
        <span key={i}>
          <span className="inline-block overflow-hidden align-bottom">
            <motion.span
              className="inline-block"
              initial={reduced ? false : { y: "108%" }}
              animate={revealed ? { y: "0%" } : undefined}
              transition={{ duration: 0.9, delay: delay + i * 0.055, ease: [0.16, 1, 0.3, 1] }}
            >
              {w}
            </motion.span>
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}
