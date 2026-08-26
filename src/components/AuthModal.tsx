"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { useConnect } from "wagmi";
import { base } from "wagmi/chains";
import { WALLETS } from "@/lib/wallets";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { CoinbaseIcon, MetaMaskIcon, PhantomIcon } from "./icons/Wallets";
import { Logo } from "./Logo";
import { AccountForm, type AccountMode } from "./AccountForm";

const ICONS: Record<string, (p: { className?: string }) => React.ReactElement> = {
  coinbaseWalletSDK: CoinbaseIcon,
  metaMask: MetaMaskIcon,
  phantom: PhantomIcon,
};

/**
 * One door with two ways through it.
 *
 * Email opens a custodial account CAPX holds for you; a wallet keeps you in
 * self-custody. Both are first-class, and the modal names the difference rather
 * than burying it — it decides who holds the assets.
 */
export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectors, connect, isPending } = useConnect();
  const { enabled: custodialEnabled, refresh } = useCapimonAccount();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const [mode, setMode] = useState<AccountMode>("signup");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

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
            role="dialog" aria-modal="true" aria-label="Sign in to CAPX"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            // vh is the fallback; dvh only applies where the browser supports
            // it, so the sheet is constrained either way and never runs off the
            // bottom of the screen.
            style={{ maxHeight: "min(92dvh, 92vh)" }}
            className="safe-b fixed inset-x-0 bottom-0 z-[90] max-h-[92vh] overflow-y-auto overscroll-contain rounded-t-3xl border-t hairline bg-[var(--bg)] p-6 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--border)] sm:hidden" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Logo className="h-7 w-7" />
                <h2 className="font-[family-name:var(--font-display)] text-lg font-medium tracking-[-0.03em]">
                  Welcome to CAPX
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
                <div className="mt-5">
                  <AccountForm mode={mode} onModeChange={setMode} compact onDone={async () => { await refresh(); onClose(); }} />
                </div>

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
              A wallet keeps you in <span className="text-[var(--fg)]">self-custody</span> — CAPX
              holds nothing and you sign every transaction.
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(body, document.body);
}
