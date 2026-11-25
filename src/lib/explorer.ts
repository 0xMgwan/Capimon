/**
 * Links to the chain, in one place.
 *
 * The explorer URL was written inline in six files, which is fine until the
 * day a security lists on a chain that is not Base and five of the six still
 * point at basescan. Anything that shows a hash should be able to link it
 * without deciding that question for itself.
 *
 * A hash on screen that cannot be clicked is a hash somebody has to select,
 * copy and paste into another tab — and on a supervisory portal, where
 * checking the chain is the entire point of showing the hash at all, that is
 * the difference between evidence and decoration.
 */

const EXPLORERS: Record<number, string> = {
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
  1: "https://etherscan.io",
};

/** Base mainnet, which is where CAPX settles. */
export const DEFAULT_CHAIN = 8453;

export const explorerBase = (chainId = DEFAULT_CHAIN) =>
  EXPLORERS[chainId] ?? EXPLORERS[DEFAULT_CHAIN];

export const txUrl = (hash: string, chainId = DEFAULT_CHAIN) =>
  `${explorerBase(chainId)}/tx/${hash}`;

export const addressUrl = (address: string, chainId = DEFAULT_CHAIN) =>
  `${explorerBase(chainId)}/address/${address}`;

export const tokenUrl = (address: string, chainId = DEFAULT_CHAIN) =>
  `${explorerBase(chainId)}/token/${address}`;

/** `0x1234…cdef` — enough to recognise, short enough to sit in a table. */
export const shortHash = (h: string, lead = 10, tail = 8) =>
  h.length > lead + tail + 1 ? `${h.slice(0, lead)}…${h.slice(-tail)}` : h;
