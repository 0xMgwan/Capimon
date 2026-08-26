"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type CustodialPosition = {
  symbol: string; ticker: string; name: string; color: string; logo: string | null;
  qty: number; price: number; value: number; change: number;
};

export type CustodialAccount = {
  user: { id: string; email: string; username: string | null; name: string | null; phone: string | null; ntzsUserId: string | null; kycStatus: string };
  cash: number;
  /** Shillings held directly, when the treasury route is in use. */
  tzs: number;
  /** Cash expressed in shillings at the live rate; null when unavailable. */
  cashTzs: number | null;
  usdcPerTzs: number | null;
  /** Which rail deposits will use, and its floor in whole shillings. */
  depositRoute: string | null;
  depositMinTzs: number;
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

const CURRENCY_KEY = "capx-currency";

/**
 * Which currency figures are shown in.
 *
 * Defaults to shillings for an account funded in shillings — a Tanzanian user
 * should not have to convert in their head to read their own balance — and the
 * choice is remembered once made.
 */
export function useCurrency() {
  const { account } = useCapimonAccount();

  // Read once, lazily, so the saved choice applies on the first paint without
  // a state write during an effect.
  const [override, setOverride] = useState<"TZS" | "USDC" | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = window.localStorage.getItem(CURRENCY_KEY);
      return saved === "TZS" || saved === "USDC" ? saved : null;
    } catch {
      return null;
    }
  });

  const rate = account?.usdcPerTzs ?? null;
  const canShowTzs = !!rate && rate > 0;
  const currency: "TZS" | "USDC" = !canShowTzs ? "USDC" : override ?? "TZS";

  const set = (c: "TZS" | "USDC") => {
    setOverride(c);
    try { localStorage.setItem(CURRENCY_KEY, c); } catch { /* session only */ }
  };

  /** Formats a USD/USDC figure in the chosen currency. */
  const format = (usdc: number) =>
    currency === "TZS" && rate
      ? `${Math.round(usdc / rate).toLocaleString()} TZS`
      : usdc.toLocaleString("en-US", { style: "currency", currency: "USD",
          minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const toUsdc = (amount: number) => (currency === "TZS" && rate ? amount * rate : amount);
  const fromUsdc = (usdc: number) => (currency === "TZS" && rate ? usdc / rate : usdc);

  return { currency, setCurrency: set, canShowTzs, rate, format, toUsdc, fromUsdc };
}
