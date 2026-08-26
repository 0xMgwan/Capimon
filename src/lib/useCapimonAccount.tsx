"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type CustodialPosition = {
  symbol: string; ticker: string; name: string; color: string; logo: string | null;
  qty: number; price: number; value: number; change: number;
};

export type CustodialAccount = {
  user: { id: string; email: string; name: string | null; phone: string | null; ntzsUserId: string | null; kycStatus: string };
  cash: number;
  positions: CustodialPosition[];
  equity: number;
  total: number;
  entries: { id: string; kind: string; asset: string; amount: string; created_at: string }[];
  capabilities: { ntzs: boolean; trading: boolean };
};

type Ctx = {
  account: CustodialAccount | null;
  /** False when the deployment has no custodial database configured at all. */
  enabled: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AccountCtx = createContext<Ctx>({
  account: null, enabled: false, loading: true,
  refresh: async () => {}, signOut: async () => {},
});

/**
 * The signed-in custodial account, if there is one. Separate from the wallet:
 * a connected wallet is self-custody, a signed-in account is not, and the two
 * are deliberately independent so the UI can tell them apart.
 */
export function CapimonAccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<CustodialAccount | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/account/me", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) { setAccount(j as CustodialAccount); setEnabled(true); }
      else { setAccount(null); setEnabled(j.code !== "not_configured"); }
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/account/logout", { method: "POST" }).catch(() => {});
    setAccount(null);
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [refresh]);

  return (
    <AccountCtx.Provider value={{ account, enabled, loading, refresh, signOut }}>
      {children}
    </AccountCtx.Provider>
  );
}

export const useCapimonAccount = () => useContext(AccountCtx);
