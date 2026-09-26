"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

/**
 * Keeps the CAPX session and the connected wallet telling the same story.
 *
 * Two things were wrong, and they are opposite halves of one idea.
 *
 * Connecting a wallet CAPX already knows said nothing: the address was linked
 * to an account, and the app went on treating whoever held it as a stranger.
 * Now it recognises the address and offers to continue as that account — one
 * signature, the same one linking asked for, because that is the only thing
 * that proves the key is still in the holder's hands.
 *
 * Disconnecting a wallet left the session standing. For a session opened with
 * a password that is right — the wallet was never the evidence. For one
 * opened *by* the wallet it is not: the only thing proving who this was has
 * just been withdrawn, and leaving somebody signed in on evidence they have
 * taken back is a strange thing for a broker to do. So those end.
 *
 * Nothing here signs anybody in without asking. A signature prompt that
 * appears on its own is indistinguishable from a phishing attempt, and this
 * is a wallet.
 */
export function WalletSession() {
  const { t } = useT();
  const { account, refresh, signOut } = useCapimonAccount();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [offer, setOffer] = useState<{ address: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Addresses already asked about, so a decline is not asked again. */
  const asked = useRef<Set<string>>(new Set());
  const wasConnected = useRef(false);

  /* 1 — a wallet we know, with nobody signed in. */
  useEffect(() => {
    if (account || !isConnected || !address) return;
    const key = address.toLowerCase();
    if (asked.current.has(key)) return;
    asked.current.add(key);

    let alive = true;
    fetch("/api/self/signin", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j.ok) return;
        setOffer({
          address,
          label: j.account?.username ? `@${j.account.username}` : j.account?.name ?? t("your CAPX account"),
        });
      })
      .catch(() => { /* an unknown wallet is the normal case */ });
    return () => { alive = false; };
  }, [account, address, isConnected, t]);

  /* 2 — the wallet that opened this session has gone. */
  useEffect(() => {
    if (isConnected) { wasConnected.current = true; return; }
    if (!wasConnected.current) return;
    wasConnected.current = false;
    if (account?.user.via === "wallet") void signOut();
  }, [isConnected, account, signOut]);

  const continueAs = async () => {
    if (!offer) return;
    setBusy(true);
    try {
      const start = await (await fetch("/api/self/signin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: offer.address }),
      })).json();
      if (!start.ok) throw new Error(start.error);
      const signature = await signMessageAsync({ message: start.message });
      const done = await (await fetch("/api/self/signin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: offer.address, signature }),
      })).json();
      if (!done.ok) throw new Error(done.error);
      haptic("success");
      setOffer(null);
      await refresh();
    } catch {
      // Declining in the wallet is the common outcome and is not an error.
      setOffer(null);
    } finally { setBusy(false); }
  };

  if (!offer || account) return null;

  return (
    <div className="fixed inset-x-3 bottom-[5.25rem] z-40 mx-auto max-w-sm rounded-2xl border hairline bg-[var(--bg)] p-3.5 shadow-2xl shadow-black/15 md:bottom-4">
      <p className="text-[13.5px] font-medium">
        {t("Welcome back")}, {offer.label}
      </p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
        {t("This wallet is linked to your CAPX account. One signature signs you in — it approves nothing and cannot move funds.")}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => { haptic(); void continueAs(); }}
          disabled={busy}
          className="flex-1 rounded-full bg-[var(--fg)] py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-50"
        >
          {busy ? t("Working…") : t("Continue")}
        </button>
        <button
          onClick={() => setOffer(null)}
          className="rounded-full border hairline px-4 py-2.5 text-[13px] font-medium hover:surface"
        >
          {t("Not now")}
        </button>
      </div>
    </div>
  );
}
