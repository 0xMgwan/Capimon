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
  const [error, setError] = useState<string | null>(null);
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

  /*
   * Re-opened on request.
   *
   * The prompt appears once per address and can be dismissed; the wallet
   * menu offers the same thing afterwards, and asks for it through this.
   */
  useEffect(() => {
    const reopen = () => {
      if (account || !address) return;
      fetch("/api/self/signin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (!j.ok) return;
          setError(null);
          setOffer({
            address,
            label: j.account?.username ? `@${j.account.username}` : j.account?.name ?? t("your CAPX account"),
          });
        })
        .catch(() => { /* nothing to offer */ });
    };
    window.addEventListener("capx:wallet-signin", reopen);
    return () => window.removeEventListener("capx:wallet-signin", reopen);
  }, [account, address, t]);

  const continueAs = async () => {
    if (!offer) return;
    setBusy(true); setError(null);
    try {
      const start = await (await fetch("/api/self/signin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: offer.address }),
      })).json();
      if (!start.ok) throw new Error(start.error);

      /*
       * Bounded, because a wallet that never answers is a real outcome.
       *
       * MetaMask does not always raise its window — a tab in the background,
       * an extension that has gone to sleep, a request queued behind another
       * one — and `signMessageAsync` simply never settles. With no timeout
       * the button said "Working…" for the rest of the session, with no
       * error and no way back, which is precisely what it should never do.
       */
      const signature = await Promise.race([
        signMessageAsync({ message: start.message }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 90_000)),
      ]);

      const done = await (await fetch("/api/self/signin", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: offer.address, signature }),
      })).json();
      if (!done.ok) throw new Error(done.error);
      haptic("success");
      setOffer(null);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      /*
       * Declining is a decision, not a failure: it closes the prompt without
       * complaint. Everything else is said out loud — a silent close after a
       * signature that did not work is indistinguishable from one that did.
       */
      if (/user rejected|denied|user cancel/i.test(msg)) {
        setOffer(null);
      } else if (msg === "timeout") {
        setError(t("Your wallet did not answer. Open it and try again."));
      } else {
        setError(msg || t("That did not go through"));
      }
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
          onClick={() => { setOffer(null); setError(null); }}
          className="rounded-full border hairline px-4 py-2.5 text-[13px] font-medium hover:surface"
        >
          {t("Not now")}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] leading-snug text-[var(--color-down)]">{error}</p>}
    </div>
  );
}
