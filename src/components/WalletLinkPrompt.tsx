"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { base } from "wagmi/chains";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

/**
 * Asks to link a wallet at the moment it is connected, not at the moment it
 * is needed.
 *
 * Linking used to happen on the buy button: somebody with a verified account
 * and a connected wallet typed an amount, read a price, reached for Buy and
 * found a different word there. That is the worst place to introduce a step —
 * it interrupts the one action the whole screen was for, and it reads as a
 * refusal rather than as setup.
 *
 * So it is asked here, wherever the customer happens to be, as soon as all
 * the conditions for it are true: an account, verified, a wallet connected on
 * Base, and no link yet. By the time they reach a ticket the button says Buy.
 *
 * Dismissible, and the dismissal is remembered for the session only. This is
 * setup rather than an alert, and somebody who is browsing should be able to
 * keep browsing — but they should also meet it again next time rather than
 * never, because without it they cannot trade into their own wallet at all.
 */
const DISMISSED = "capx-wallet-link-dismissed";

export function WalletLinkPrompt() {
  const { t } = useT();
  const { account } = useCapimonAccount();
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [linked, setLinked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    // Read in a task, and never let a blocked sessionStorage throw: a prompt
    // is not worth breaking a page over.
    const id = window.setTimeout(() => {
      try { setHidden(sessionStorage.getItem(DISMISSED) === "1"); }
      catch { setHidden(false); }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const load = useCallback(async () => {
    if (!account || !isConnected) { setLinked(null); return; }
    try {
      const j = await (await fetch("/api/self/link", { cache: "no-store" })).json();
      setLinked(j.ok ? j.wallets.map((w: { address: string }) => w.address.toLowerCase()) : []);
    } catch { setLinked(null); }
  }, [account, isConnected]);

  useEffect(() => { void load(); }, [load]);

  const link = async () => {
    if (!address) return;
    setBusy(true); setError(null);
    try {
      const start = await (await fetch("/api/self/link", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      })).json();
      if (!start.ok) throw new Error(start.error);
      const signature = await signMessageAsync({ message: start.message });
      const done = await (await fetch("/api/self/link", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature }),
      })).json();
      if (!done.ok) throw new Error(done.error);
      haptic("success");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("Could not link that wallet");
      setError(/user rejected|denied/i.test(msg) ? t("You cancelled that in your wallet.") : msg);
    } finally {
      setBusy(false);
    }
  };

  const ready =
    !hidden && !!account && account.user.kycStatus === "approved" &&
    isConnected && chainId === base.id && !!address &&
    linked !== null && !linked.includes(address.toLowerCase());

  if (!ready) return null;

  return (
    <div className="rounded-2xl border hairline p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">{t("Link this wallet to trade into it")}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
            {t("One signature proves the address is yours. It approves nothing and cannot move funds — CAPX will not send shares to an address it has not checked.")}
          </p>
          <p className="tnum mt-1.5 truncate text-[11px] text-[var(--muted)]">{address}</p>
        </div>
        <button
          onClick={() => {
            setHidden(true);
            try { sessionStorage.setItem(DISMISSED, "1"); } catch { /* it simply asks again */ }
          }}
          aria-label={t("Not now")}
          className="shrink-0 text-[var(--muted)] hover:text-[var(--fg)]"
        >
          ✕
        </button>
      </div>
      <button
        onClick={() => { haptic(); void link(); }}
        disabled={busy}
        className="mt-3 w-full rounded-full bg-[var(--fg)] py-2.5 text-[13px] font-medium text-[var(--bg)] active:scale-95 disabled:opacity-50"
      >
        {busy ? t("Working…") : t("Link this wallet")}
      </button>
      {error && <p className="mt-2 text-[12px] text-[var(--color-down)]">{error}</p>}
    </div>
  );
}
