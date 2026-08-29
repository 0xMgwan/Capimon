"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useAccount } from "wagmi";
import { useCapimonAccount } from "@/lib/useCapimonAccount";

const TABS = [
  {
    href: "/", label: "Home",
    icon: <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8.5Z" />,
  },
  {
    href: "/markets", label: "Markets",
    icon: <path d="M4 18l5-6 4 3.5L20 7" />,
  },
  {
    href: "/portfolio", label: "Portfolio",
    icon: <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Zm4 0V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  },
  {
    href: "/settings", label: "Account",
    icon: <><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" /></>,
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
  const { isConnected } = useAccount();
  const { account } = useCapimonAccount();

  if (!isConnected && !account) return null;

  return (
    <>
    {/* Clearance for the fixed bar, scoped to when the bar actually exists. */}
    <div className="h-[4.25rem] md:hidden" />
    <nav className="safe-b fixed inset-x-0 bottom-0 z-50 border-t hairline bg-[var(--bg)] md:hidden">
      <div className="flex">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center gap-1 py-2.5 active:scale-95 transition-transform"
              style={{ color: active ? "var(--fg)" : "var(--muted)" }}
            >
              {active && (
                <motion.span
                  layoutId="tab-indicator"
                  className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-[var(--color-accent)]"
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                />
              )}
              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {t.icon}
              </svg>
              <span className="text-[10px] font-medium tracking-tight">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
    </>
  );
}
