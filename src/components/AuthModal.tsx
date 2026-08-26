"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { useConnect } from "wagmi";
import { base } from "wagmi/chains";
import { WALLETS } from "@/lib/wallets";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { CoinbaseIcon, MetaMaskIcon, PhantomIcon } from "./icons/Wallets";
import { Logo } from "./Logo";

const ICONS: Record<string, (p: { className?: string }) => React.ReactElement> = {
  coinbaseWalletSDK: CoinbaseIcon,
  metaMask: MetaMaskIcon,
  phantom: PhantomIcon,
};

/**
 * One door with two ways through it.
 *
 * Email opens a custodial account CAPIMON holds for you; a wallet keeps you in
 * self-custody. Both are first-class, and the modal names the difference rather
 * than burying it — it decides who holds the assets.
 */
export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectors, connect, isPending } = useConnect();
  const { enabled: custodialEnabled, refresh } = useCapimonAccount();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() => emailRef.current?.focus());
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/account/${mode === "signup" ? "register" : "login"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not sign you in");
      await refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  const body = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label="Sign in to CAPIMON"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="safe-b fixed inset-x-0 bottom-0 z-[90] max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t hairline bg-[var(--bg)] p-6 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--border)] sm:hidden" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Logo className="h-7 w-7" />
                <h2 className="font-[family-name:var(--font-display)] text-lg font-medium tracking-[-0.03em]">
                  Welcome to CAPIMON
                </h2>
              </div>
              <button onClick={onClose} aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-full border hairline transition-colors hover:surface">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {custodialEnabled && (
              <>
                <div className="mt-5 flex rounded-full surface p-1">
                  {(["signin", "signup"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setMode(m); setError(null); }}
                      className={`flex-1 rounded-full py-2 text-sm font-medium transition-colors ${
                        mode === m ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
                      }`}
                    >
                      {m === "signin" ? "Sign in" : "Create account"}
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid gap-2.5">
                  <input
                    ref={emailRef}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    type="email" placeholder="Email address" autoComplete="email"
                    className="w-full rounded-xl border hairline bg-transparent px-4 py-3 text-sm outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--color-accent)]"
                  />
                  <input
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    type="password" placeholder="Password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                    className="w-full rounded-xl border hairline bg-transparent px-4 py-3 text-sm outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--color-accent)]"
                  />
                  {mode === "signup" && (
                    <input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      inputMode="numeric" placeholder="Mobile money number (optional)"
                      className="w-full rounded-xl border hairline bg-transparent px-4 py-3 text-sm outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--color-accent)]"
                    />
                  )}
                </div>

                <button
                  onClick={submit}
                  disabled={busy || !form.email || !form.password}
                  className="mt-3 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                >
                  {busy ? "Working…" : mode === "signup" ? "Create account" : "Continue"}
                </button>

                <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
                  An email account is <span className="text-[var(--fg)]">custodial</span> — CAPIMON
                  holds your assets and records what you are owed. Fund it with mobile money in
                  shillings.
                </p>

                <div className="my-5 flex items-center gap-3">
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  <span className="eyebrow">or</span>
                  <span className="h-px flex-1 bg-[var(--border)]" />
                </div>
              </>
            )}

            <div className="grid grid-cols-3 gap-2">
              {WALLETS.map((w) => {
                const connector = connectors.find((c) => c.id === w.id);
                const Icon = ICONS[w.id];
                return (
                  <button
                    key={w.id}
                    onClick={() => {
                      if (connector) { connect({ connector, chainId: base.id }); onClose(); }
                      else window.open(w.install, "_blank", "noreferrer");
                    }}
                    disabled={isPending}
                    title={w.name}
                    className="flex flex-col items-center gap-2 rounded-2xl border hairline px-2 py-4 transition-colors hover:surface active:scale-95 disabled:opacity-60"
                  >
                    <Icon className="h-9 w-9 rounded-xl" />
                    <span className="truncate text-[11px] font-medium">{w.name.split(" ")[0]}</span>
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
              A wallet keeps you in <span className="text-[var(--fg)]">self-custody</span> — CAPIMON
              holds nothing and you sign every transaction.
            </p>

            {error && <p className="mt-3 text-xs text-[var(--color-down)]">{error}</p>}

            <p className="mt-5 border-t hairline pt-4 text-center text-[11px] text-[var(--muted)]">
              <Link href="/how-it-works" className="hover:text-[var(--fg)]">How it works</Link>
              {" · "}
              <Link href="/join" className="hover:text-[var(--fg)]">Fund with shillings</Link>
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(body, document.body);
}
