import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

/**
 * The three wallets CAPIMON supports. Coinbase Wallet uses its own SDK so it also
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

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    coinbaseWallet({ appName: "CAPIMON", preference: "all" }),
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
