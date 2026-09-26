"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useAccount } from "wagmi";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";

/*
 * Filled glyphs rather than outline strokes.
 *
 * A 1.7px stroke at 21px reads as a thin scratch on a phone, and every icon
 * ended up the same visual weight as every other — the bar looked generic
 * because nothing in it had mass. Solid shapes hold their form at this size and
 * invert cleanly against the active pill.
 */
const TABS = [
  {
    href: "/", label: "Home",
    // House with the doorway cut out, so the shape reads at a glance.
    icon: (
      <path
        fillRule="evenodd"
        d="M11.36 2.72a1 1 0 0 1 1.28 0l8.5 7.1A1 1 0 0 1 20.5 11.6h-.9v7.15a2.25 2.25 0 0 1-2.25 2.25h-2.9v-5.1a2.45 2.45 0 0 0-4.9 0V21h-2.9A2.25 2.25 0 0 1 4.4 18.75V11.6h-.9a1 1 0 0 1-.64-1.77l8.5-7.11Z"
      />
    ),
  },
  {
    href: "/markets", label: "Markets",
    // Three rising bars — a market, not a generic chart line.
    icon: (
      <>
        <rect x="3.4" y="13.2" width="4.1" height="7.4" rx="1.5" opacity="0.55" />
        <rect x="9.95" y="9.1" width="4.1" height="11.5" rx="1.5" opacity="0.78" />
        <rect x="16.5" y="4.2" width="4.1" height="16.4" rx="1.5" />
      </>
    ),
  },
  {
    href: "/portfolio", label: "Portfolio",
    // A briefcase: what you hold, rather than an abstract folder.
    icon: (
      <>
        <path d="M9.1 3.6A2.4 2.4 0 0 1 11.5 2.6h1a2.4 2.4 0 0 1 2.4 1v1.05h-1.9V4.6a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v.05H9.1V3.6Z" />
        <path
          fillRule="evenodd"
          d="M3 8.5a2.4 2.4 0 0 1 2.4-2.4h13.2A2.4 2.4 0 0 1 21 8.5v2.34l-9 2.5-9-2.5V8.5Zm0 4.42V18.6A2.4 2.4 0 0 0 5.4 21h13.2a2.4 2.4 0 0 0 2.4-2.4v-5.68l-8.06 2.24a2.1 2.1 0 0 1-1.12 0L3 12.92Z"
        />
      </>
    ),
  },
  {
    href: "/activity", label: "Activity",
    // A receipt with a fold in it: what this page is, rather than a clock,
    // which would say "history" — and history is not what people come for.
    icon: (
      <>
        <path
          fillRule="evenodd"
          d="M5.2 3.4A1.6 1.6 0 0 1 6.8 1.8h7.35a1.6 1.6 0 0 1 1.13.47l3.45 3.45a1.6 1.6 0 0 1 .47 1.13V20.6a1.6 1.6 0 0 1-1.6 1.6H6.8a1.6 1.6 0 0 1-1.6-1.6V3.4Zm3.3 7.5a1 1 0 0 0 0 2h7a1 1 0 1 0 0-2h-7Zm0 4a1 1 0 1 0 0 2h4.4a1 1 0 1 0 0-2H8.5Z"
        />
      </>
    ),
  },
  {
    href: "/settings", label: "Account",
    icon: (
      <>
        <circle cx="12" cy="7.6" r="3.9" />
        <path d="M12 13.1c-4.1 0-7.4 2.42-7.4 5.4 0 1.38 1.05 2.5 2.35 2.5h10.1c1.3 0 2.35-1.12 2.35-2.5 0-2.98-3.3-5.4-7.4-5.4Z" />
      </>
    ),
  },
];

/**
 * Phone navigation for anyone signed in.
 *
 * This used to require a connected wallet, which meant the customers CAPX is
 * actually built for — who sign in with an email and never touch a wallet —
 * never saw it, and moved around a trading app through a hamburger menu. An
 * account is an account however it was opened.
 *
 * A visitor who has not signed in still gets the menu: with nothing to move
 * around inside, a tab bar is chrome over a landing page.
 */
export function MobileTabs() {
  const path = usePathname();
  const { t: translate } = useT();
  const { isConnected } = useAccount();
  const { account } = useCapimonAccount();

  /*
   * Pinned to what you can actually see.
   *
   * `position: fixed; bottom: 0` anchors to the *layout* viewport, and on iOS
   * that is not the strip of screen you are looking at: Safari's toolbar
   * animates in and out over it, and the two viewports disagree for the
   * length of every animation. The bar is told to sit at the bottom the whole
   * time and obeys — of a rectangle that is not where the bottom appears to
   * be — so it slides as you scroll and settles when you stop.
   *
   * The visual viewport reports the difference. Correcting for it puts the
   * bar on the edge of the visible area rather than the edge of the document,
   * which is the one the thumb is aiming at. On a device where the two never
   * diverge — Android, a desktop, an installed app with no toolbar — the gap
   * is zero and this does nothing at all.
   *
   * A keyboard collapses the visual viewport by several hundred pixels. That
   * is not a toolbar and the bar should stay where it is rather than climbing
   * the screen over the field being typed into, so corrections are capped.
   */
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const el = barRef.current;
    if (!vv || !el) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const gap = document.documentElement.clientHeight - (vv.height + vv.offsetTop);
      el.style.transform = gap > 0.5 && gap < 160
        ? `translate3d(0, ${-gap}px, 0)`
        : "translateZ(0)";
    };
    // Coalesced: these fire continuously through a scroll, and moving the bar
    // more than once a frame is work nobody can see.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
    };
    // Re-run once the bar actually exists: on the first render of a session
    // there is no account yet and therefore no <nav> to hold, so an effect
    // with no dependencies would attach to nothing and never try again.
  }, [isConnected, account]);

  if (!isConnected && !account) return null;

  /*
   * Home is wherever your money is.
   *
   * For a signed-in customer the landing page is an advertisement for a thing
   * they already bought, and the portfolio is what they actually opened the
   * app to see — so Home points there and the separate Portfolio tab goes,
   * because two tabs to one page is a tab wasted. Somebody browsing without
   * an account still gets the landing page, which for them is the point.
   *
   * The bar is otherwise untouched: three destinations on a phone is as many
   * as a thumb can aim at without looking.
   */
  const tabs = account
    ? TABS.filter((t) => t.href !== "/portfolio").map((t) =>
        t.href === "/" ? { ...t, href: "/portfolio" } : t)
    : TABS;

  return (
    <>
    {/* Clearance for the fixed bar, scoped to when the bar actually exists. */}
    <div className="h-[4.25rem] md:hidden" />
    {/*
      * translateZ(0) puts the bar on its own compositor layer.
      *
      * iOS repaints fixed elements lazily during momentum scrolling, so a bar
      * painted with the page appears to slide up into the content and snap
      * back when the scroll stops. Its own layer is moved by the compositor
      * instead of being redrawn, which is what keeps it still. Not
      * will-change: a layer promoted for the whole session is what blanks the
      * ticker, and this needs promoting only while it exists.
      */}
    <nav
      ref={barRef}
      style={{ transform: "translateZ(0)" }}
      className="safe-b fixed inset-x-0 bottom-0 z-50 border-t hairline bg-[var(--bg)] md:hidden"
    >
      <div className="flex">
        {tabs.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center gap-1 py-2 active:scale-95 transition-transform"
              style={{ color: active ? "var(--fg)" : "var(--muted)" }}
            >
              {/*
                A hairline above the tab was the only mark of the current page,
                which reads as nothing on a phone. The active icon now sits in a
                filled pill that slides between tabs — the label carries weight
                too, so the state is legible at a glance rather than inferred
                from a two-pixel line.
              */}
              <span className="relative grid h-8 w-[3.25rem] place-items-center">
                {active && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-full bg-[var(--fg)]"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <svg
                  viewBox="0 0 24 24"
                  className="relative h-[21px] w-[21px]"
                  fill={active ? "var(--bg)" : "currentColor"}
                >
                  {t.icon}
                </svg>
              </span>
              <span className={`text-[10px] tracking-tight ${active ? "font-semibold" : "font-medium"}`}>
                {translate(t.label)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
    </>
  );
}
