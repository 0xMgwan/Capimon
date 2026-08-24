"use client";

import { useAccount, useConnect, useDisconnect, useBalance, useChainId, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { short } from "@/lib/format";
import { WALLETS } from "@/lib/wallets";
import { CoinbaseIcon, MetaMaskIcon, PhantomIcon } from "./icons/Wallets";

const ICONS: Record<string, (p: { className?: string }) => React.ReactElement> = {
  coinbaseWalletSDK: CoinbaseIcon,
  metaMask: MetaMaskIcon,
  phantom: PhantomIcon,
};

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { data: bal } = useBalance({ address, chainId: base.id, query: { enabled: !!address, refetchInterval: 15_000 } });
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // An injected connector only works if its provider is actually present, so
  // probe before offering it — otherwise the click silently does nothing.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all(
      connectors.map(async (c) => [c.id, !!(await c.getProvider().catch(() => undefined))] as const),
    ).then((pairs) => { if (alive) setInstalled(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [open, connectors]);

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
              View on BaseScan ↗
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

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="rounded-full bg-[var(--fg)] px-5 py-2 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60"
      >
        {isPending ? "Connecting…" : compact ? "Connect" : "Connect Wallet"}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border hairline bg-[var(--bg)] p-2 shadow-2xl shadow-black/10">
          <div className="eyebrow px-3 py-2">Choose a wallet</div>
          {WALLETS.map((w) => {
            const connector = connectors.find((c) => c.id === w.id);
            const Icon = ICONS[w.id];
            const detected = w.alwaysAvailable || installed[w.id];
            const probed = w.id in installed;

            if (connector && (detected || !probed)) {
              return (
                <button
                  key={w.id}
                  onClick={() => { connect({ connector, chainId: base.id }); setOpen(false); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:surface"
                >
                  <Icon className="h-8 w-8 shrink-0 rounded-lg" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{w.name}</span>
                    <span className="block truncate text-[11px] text-[var(--muted)]">{w.hint}</span>
                  </span>
                </button>
              );
            }

            return (
              <a
                key={w.id}
                href={w.install}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:surface"
              >
                <Icon className="h-8 w-8 shrink-0 rounded-lg opacity-40" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--muted)]">{w.name}</span>
                  <span className="block truncate text-[11px] text-[var(--muted)]">Not detected · install ↗</span>
                </span>
              </a>
            );
          })}
          <p className="px-3 pb-1 pt-2 text-[11px] leading-snug text-[var(--muted)]">
            CAPIMON never takes custody. Every transaction is signed in your own wallet.
          </p>
        </div>
      )}
    </div>
  );
}
