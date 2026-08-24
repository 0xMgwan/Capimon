"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Logo, Wordmark } from "./Logo";
import { WalletButton } from "./WalletButton";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/how-it-works", label: "How it works" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const path = usePathname();
  // The menu belongs to the route it was opened on, so navigating closes it
  // without an effect that resets state on every path change.
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const menu = menuAt === path;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    // Probe on the next frame — a restored scroll position still resolves before paint.
    const raf = requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header>
      <motion.div
        animate={{ paddingTop: scrolled ? 10 : 16, paddingBottom: scrolled ? 10 : 16 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className={`bg-[var(--nav)] backdrop-blur-xl transition-colors duration-300 ${
          scrolled ? "border-b hairline" : "border-b border-transparent"
        }`}
      >
        <nav className="mx-auto flex max-w-[1400px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="group flex items-center gap-2.5">
            <Logo className="h-7 w-7 transition-transform duration-500 group-hover:rotate-[20deg]" />
            <Wordmark />
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => {
              const active = path === l.href || path.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className="relative rounded-full px-4 py-2 text-sm transition-colors hover:text-[var(--fg)]"
                  style={{ color: active ? "var(--fg)" : "var(--muted)" }}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-full surface"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10">{l.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="hidden sm:block"><WalletButton /></div>
            <button
              onClick={() => setMenuAt(menu ? null : path)}
              aria-label="Menu"
              className="grid h-9 w-9 place-items-center rounded-full border hairline md:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round">
                {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
              </svg>
            </button>
          </div>
        </nav>
      </motion.div>

      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="border-y hairline bg-[var(--bg)] px-5 py-4 md:hidden"
          >
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="block py-3 text-lg tracking-tight">
                {l.label}
              </Link>
            ))}
            <div className="pt-3 sm:hidden"><WalletButton /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
