"use client";

import { useAccount, useDisconnect, useBalance, useChainId, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { short, usd } from "@/lib/format";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { AuthModal } from "./AuthModal";

/**
 * The single entry point: signed out it opens the auth modal, signed in it
 * shows whichever identity the visitor actually has — a wallet address for
 * self-custody, an email for a custodial account.
 */
export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected } = useAccount();
  const { account, signOut } = useCapimonAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { data: bal } = useBalance({ address, chainId: base.id, query: { enabled: !!address, refetchInterval: 15_000 } });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (isConnected && address) {
    const wrongChain = chainId !== base.id;
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => (wrongChain ? switchChain({ chainId: base.id }) : setOpen((o) => !o))}
          className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
            wrongChain ? "bg-[var(--color-down)] text-white" : "border hairline surface hover:border-[var(--color-accent)]"
          }`}
        >
          {wrongChain ? "Switch to Base" : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-up)]" />
              <span className="tnum">{short(address)}</span>
            </>
          )}
        </button>

        {open && !wrongChain && (
          <div className="absolute right-0 z-50 mt-2 w-60 rounded-2xl border hairline bg-[var(--bg)] p-2 shadow-2xl shadow-black/10">
            <div className="rounded-xl surface p-3">
              <div className="eyebrow">Connected · Base</div>
              <div className="tnum mt-1 text-sm">{short(address)}</div>
              <div className="tnum mt-2 text-xs text-[var(--muted)]">
                {bal ? `${Number(formatUnits(bal.value, bal.decimals)).toFixed(5)} ${bal.symbol}` : "—"} for gas
              </div>
            </div>
            <a href={`https://basescan.org/address/${address}`} target="_blank" rel="noreferrer"
              className="mt-1 block rounded-xl px-3 py-2 text-sm transition-colors hover:surface">
              View wallet onchain ↗
            </a>
            <button
              onClick={() => { disconnect(); setOpen(false); }}
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-[var(--color-down)] transition-colors hover:surface"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // Signed into a custodial account with no wallet: show that identity instead.
  if (account) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-full border hairline surface px-4 py-2 text-sm font-medium transition-colors hover:border-[var(--color-accent)]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-up)]" />
          <span className="max-w-[10rem] truncate">{account.user.email}</span>
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-60 rounded-2xl border hairline bg-[var(--bg)] p-2 shadow-2xl shadow-black/10">
            <div className="rounded-xl surface p-3">
              <div className="eyebrow">Custodial account</div>
              <div className="tnum mt-1 text-sm">{usd(account.total)}</div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">held by CAPX for you</div>
            </div>
            <a href="/portfolio" className="mt-1 block rounded-xl px-3 py-2 text-sm transition-colors hover:surface">Portfolio</a>
            <a href="/join" className="block rounded-xl px-3 py-2 text-sm transition-colors hover:surface">Fund with shillings</a>
            <button
              onClick={() => { void signOut(); setOpen(false); }}
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-[var(--color-down)] transition-colors hover:surface"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setAuthOpen(true)}
        className="rounded-full bg-[var(--fg)] px-5 py-2 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03] active:scale-95"
      >
        {compact ? "Sign in" : "Sign in"}
      </button>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}
