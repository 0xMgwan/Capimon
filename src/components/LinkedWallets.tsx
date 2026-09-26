"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { base } from "wagmi/chains";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

/**
 * The wallets this account has proved it controls.
 *
 * A link is a standing permission — it is what lets CAPX send a tokenised
 * share to an address — so it belongs somewhere a customer can look it up and
 * take it back, which is the same place the rest of their account settings
 * are. Without this the only evidence of a link was a button on a trade
 * ticket that had stopped appearing once the link worked.
 *
 * Unlinking is immediate and needs no signature: proving you hold a key is
 * how you claim an address, and no proof should be required to disclaim one.
 */
type Wallet = { address: string; verifiedAt: string };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function LinkedWallets() {
  const { t } = useT();
  const { account } = useCapimonAccount();
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!account) return;
    try {
      const j = await (await fetch("/api/self/link", { cache: "no-store" })).json();
      setWallets(j.ok ? j.wallets : []);
    } catch { setWallets([]); }
  }, [account]);

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
    } finally { setBusy(false); }
  };

  const unlink = async (a: string) => {
    setBusy(true); setError(null);
    try {
      await fetch(`/api/self/link?address=${encodeURIComponent(a)}`, { method: "DELETE" });
      await load();
    } catch { setError(t("Could not unlink that wallet")); }
    finally { setBusy(false); }
  };

  if (!account || wallets === null) return null;

  const connectedUnlinked =
    isConnected && chainId === base.id && !!address &&
    !wallets.some((w) => w.address.toLowerCase() === address.toLowerCase());

  // Nothing linked and nothing connected is not a setting anybody is looking
  // for; it appears once there is something to say.
  if (wallets.length === 0 && !connectedUnlinked) return null;

  return (
    <section className="mt-3 rounded-2xl border hairline p-3.5 sm:p-4">
      <div className="text-[14px] font-medium">{t("Linked wallets")}</div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
        {t("Addresses CAPX will send tokenised shares to. Only you can add one, by signing from it.")}
      </p>

      <div className="mt-3 grid gap-1.5">
        {wallets.map((w) => (
          <div key={w.address} className="flex items-center gap-3 rounded-xl surface px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="tnum block truncate text-[13px]">{short(w.address)}</span>
              <span className="block text-[11px] text-[var(--muted)]">
                {address && w.address.toLowerCase() === address.toLowerCase()
                  ? t("Connected now")
                  : `${t("Linked")} ${new Date(w.verifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
              </span>
            </span>
            <button
              onClick={() => { haptic(); void unlink(w.address); }}
              disabled={busy}
              className="shrink-0 text-[11px] text-[var(--muted)] underline-offset-2 hover:text-[var(--color-down)] hover:underline disabled:opacity-50"
            >
              {t("Unlink")}
            </button>
          </div>
        ))}
      </div>

      {connectedUnlinked && (
        <button
          onClick={() => { haptic(); void link(); }}
          disabled={busy}
          className="mt-3 w-full rounded-full border hairline py-2.5 text-[13px] font-medium hover:surface disabled:opacity-50"
        >
          {busy ? t("Working…") : `${t("Link")} ${short(address!)}`}
        </button>
      )}

      {error && <p className="mt-2 text-[12px] text-[var(--color-down)]">{error}</p>}
    </section>
  );
}
