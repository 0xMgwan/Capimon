import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet, metaMask, walletConnect } from "wagmi/connectors";

/**
 * The three wallets CAPX supports.
 *
 * Coinbase and MetaMask each connect through their own SDK. That matters on a
 * phone: the SDK opens the wallet app to approve and hands control straight
 * back to the browser the customer was already in, which is the flow people
 * expect. Opening our site inside the wallet's browser instead — which is all
 * a deep link can do — moves them into an app they did not ask to be in.
 *
 * Phantom has no such SDK for the web. In its own browser and as a desktop
 * extension it injects a provider like anything else, and on a phone it is
 * reachable through WalletConnect when a project id is configured.
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
    // The SDK connector's own id, not "metaMask": wagmi calls it this.
    id: "metaMaskSDK",
    name: "MetaMask",
    hint: "Extension or the app on your phone",
    install: "https://metamask.io/download/",
    /** The SDK reaches the phone app with nothing installed in the browser. */
    alwaysAvailable: true,
  },
  {
    id: "phantom",
    name: "Phantom",
    hint: "Extension, or the app over WalletConnect",
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

/**
 * WalletConnect's project id, which is what lets a phone wallet with no SDK
 * of its own — Phantom, here — sign for a page open in the phone's browser.
 *
 * Optional: without it the other two still work, and Phantom falls back to
 * its own browser. One is free from dashboard.reown.com.
 */
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";
export const walletConnectReady = !!WC_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    // "all" offers both the app and a passkey Smart Wallet; the SDK's own
    // types want it as an object now that the SDK is actually installed.
    coinbaseWallet({ appName: "CAPX", preference: { options: "all" } }),
    metaMask({
      // Shown on MetaMask's own confirmation screen, so it says who is asking.
      dappMetadata: { name: "CAPX", url: "https://www.capx.broker" },
    }),
    injected({ target: "phantom", shimDisconnect: true }),
    ...(WC_PROJECT_ID
      ? [walletConnect({
          projectId: WC_PROJECT_ID,
          showQrModal: true,
          metadata: {
            name: "CAPX",
            description: "Tokenised shares, settled in shillings.",
            url: "https://www.capx.broker",
            icons: ["https://www.capx.broker/apple-icon"],
          },
        })]
      : []),
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
  if (id === "metaMaskSDK") return all.some((p) => p.isMetaMask);
  if (id === "coinbaseWalletSDK") return all.some((p) => p.isCoinbaseWallet);
  return false;
}

/** The URL that opens this page inside the wallet's own browser. */
export function walletDeepLink(id: WalletId, href: string): string | null {
  const url = new URL(href);
  if (id === "metaMaskSDK") {
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
export function connectRoute(id: WalletId): "connect" | "walletConnect" | "deepLink" | "install" {
  if (hasInjected(id)) return "connect";
  /*
   * Both SDKs reach their app on a phone and return the customer to the page
   * they were on, so neither needs an extension or a detour through a wallet
   * browser.
   */
  if (id === "coinbaseWalletSDK" || id === "metaMaskSDK") return "connect";
  if (!isMobile()) return "install";
  // Phantom, on a phone: WalletConnect keeps the page where it is. Without a
  // project id the only thing left is Phantom's own browser.
  return walletConnectReady ? "walletConnect" : "deepLink";
}
