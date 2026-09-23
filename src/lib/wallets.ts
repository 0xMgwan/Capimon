import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

/**
 * The three wallets CAPX supports. Coinbase Wallet uses its own SDK so it also
 * covers Smart Wallet with no extension installed; MetaMask and Phantom connect
 * through their injected providers.
 */
export const WALLETS = [
  {
    id: "coinbaseWalletSDK",
    name: "Coinbase Wallet",
    hint: "Extension, mobile or Smart Wallet",
    install: "https://www.coinbase.com/wallet/downloads",
    /** Coinbase SDK works with no extension present, so it is never "missing". */
    alwaysAvailable: true,
  },
  {
    id: "metaMask",
    name: "MetaMask",
    hint: "Browser extension",
    install: "https://metamask.io/download/",
    alwaysAvailable: false,
  },
  {
    id: "phantom",
    name: "Phantom",
    hint: "Browser extension",
    install: "https://phantom.app/download",
    alwaysAvailable: false,
  },
] as const;

export type WalletId = (typeof WALLETS)[number]["id"];

/**
 * Onboarding connector for people with no wallet: Coinbase Smart Wallet creates
 * one from an email and a passkey, with no seed phrase and no extension, while
 * the keys stay with the user. That is what makes an email-first signup possible
 * without CAPX taking custody.
 */
export const SMART_WALLET_ID = "coinbaseWalletSDK" as const;

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    coinbaseWallet({ appName: "CAPX", preference: "all" }),
    injected({ target: "metaMask", shimDisconnect: true }),
    injected({ target: "phantom", shimDisconnect: true }),
  ],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org"),
  },
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

/**
 * Connecting a wallet on a phone.
 *
 * MetaMask and Phantom connect through a provider injected into the page, and
 * on a phone there is no page to inject into: a mobile browser has no
 * extensions, so `window.ethereum` simply is not there. Tapping either button
 * called a connector that could not find its wallet and failed silently, which
 * is what "the wallets don't work on mobile" was.
 *
 * What works instead is a deep link: the wallet app has a browser of its own,
 * and these URLs open this page inside it, where the provider does exist. The
 * connection then happens normally on the other side.
 */
export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
    // iPadOS reports itself as a Mac, and gives itself away with touch.
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

type Injected = { isMetaMask?: boolean; isCoinbaseWallet?: boolean; providers?: Injected[] };

/** Is this wallet's provider actually in the page? */
export function hasInjected(id: WalletId): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { ethereum?: Injected; phantom?: { ethereum?: unknown } };
  if (id === "phantom") return !!w.phantom?.ethereum;
  const eth = w.ethereum;
  if (!eth) return false;
  // Several wallets installed at once put themselves in a list rather than
  // fighting over the one global.
  const all = eth.providers?.length ? eth.providers : [eth];
  if (id === "metaMask") return all.some((p) => p.isMetaMask);
  if (id === "coinbaseWalletSDK") return all.some((p) => p.isCoinbaseWallet);
  return false;
}

/** The URL that opens this page inside the wallet's own browser. */
export function walletDeepLink(id: WalletId, href: string): string | null {
  const url = new URL(href);
  if (id === "metaMask") {
    // MetaMask takes the address without its scheme.
    return `https://metamask.app.link/dapp/${url.host}${url.pathname}${url.search}`;
  }
  if (id === "phantom") {
    return `https://phantom.app/ul/browse/${encodeURIComponent(url.href)}?ref=${encodeURIComponent(url.origin)}`;
  }
  if (id === "coinbaseWalletSDK") {
    return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url.href)}`;
  }
  return null;
}

/**
 * How a tap on a wallet button should be handled here and now.
 *
 * "connect" when the provider is present, "deepLink" on a phone without it,
 * and "install" on a desktop without it — which is the only case where
 * sending somebody to a download page is the right answer.
 */
export function connectRoute(id: WalletId): "connect" | "deepLink" | "install" {
  if (hasInjected(id)) return "connect";
  // Coinbase's SDK needs no extension: it can reach the app or make a Smart
  // Wallet from a passkey, so it connects even with nothing installed.
  if (id === "coinbaseWalletSDK") return "connect";
  return isMobile() ? "deepLink" : "install";
}
