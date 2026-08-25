"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
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
  const { isConnected } = useAccount();
  // The menu belongs to the route it was opened on, so navigating closes it.
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const menu = menuAt === path;
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

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
            <Logo className="h-7 w-7 transition-transform duration-500 group-hover:translate-x-0.5" />
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
            {/* Before connecting there is no tab bar, so the menu carries
                navigation on phones. */}
            {!isConnected && (
              <button
                onClick={() => setMenuAt(menu ? null : path)}
                aria-label={menu ? "Close menu" : "Open menu"}
                aria-expanded={menu}
                className="grid h-9 w-9 place-items-center rounded-full border hairline transition-colors active:surface md:hidden"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round">
                  {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
                </svg>
              </button>
            )}
          </div>
        </nav>
      </motion.div>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {menu && (
              <>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={() => setMenuAt(null)}
                  className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm md:hidden"
                />
                <motion.div
                  initial={{ y: "-100%" }} animate={{ y: 0 }} exit={{ y: "-100%" }}
                  transition={{ type: "spring", stiffness: 380, damping: 38 }}
                  className="safe-t fixed inset-x-0 top-0 z-[70] rounded-b-3xl border-b hairline bg-[var(--bg)] p-5 pt-6 shadow-2xl md:hidden"
                >
                  <div className="flex items-center justify-between">
                    <Wordmark className="text-xl" />
                    <button
                      onClick={() => setMenuAt(null)}
                      aria-label="Close menu"
                      className="grid h-9 w-9 place-items-center rounded-full border hairline"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  <div className="mt-5 grid gap-1">
                    {LINKS.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        className="rounded-2xl px-3 py-3.5 text-lg tracking-tight transition-colors active:surface"
                      >
                        {l.label}
                      </Link>
                    ))}
                  </div>
                  <div className="mt-4 border-t hairline pt-4 [&>div>button]:w-full">
                    <WalletButton />
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </header>
  );
}
