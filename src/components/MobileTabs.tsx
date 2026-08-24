"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

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
    href: "/how-it-works", label: "How",
    icon: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.6.2-.9.7-.9 1.3v.4M12 17h.01" /></>,
  },
];

/** Phone navigation. A fixed bar keeps the app reachable with one thumb. */
export function MobileTabs() {
  const path = usePathname();

  return (
    <nav className="safe-b fixed inset-x-0 bottom-0 z-50 border-t hairline bg-[var(--nav)] backdrop-blur-xl md:hidden">
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
  );
}
