import { createPublicClient, fallback, http } from "viem";
import { base } from "viem/chains";
import { MULTICALL3 } from "./assets";

const RPCS = [
  process.env.BASE_RPC_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
].filter(Boolean) as string[];

/** Server-side reader. Falls back across public RPCs and batches through Multicall3. */
export const publicClient = createPublicClient({
  chain: base,
  transport: fallback(
    RPCS.map((url) => http(url, { batch: { wait: 16 }, timeout: 12_000, retryCount: 1 })),
    { rank: false },
  ),
  batch: { multicall: { batchSize: 2048, wait: 16 } },
});

/**
 * The transport a signed transaction goes out through.
 *
 * Separate from the reader's only because the batching and multicall
 * settings above are wrong for a send, not because the resilience should
 * differ — it was a single endpoint with no retry while every read had five
 * with one, which is how a rate limit on a free RPC turned into a lost daily
 * anchor.
 *
 * Retrying is safe for a send because the transaction is signed against a
 * fixed nonce before it leaves: a resend is byte-identical, so the network
 * sees one transaction however many times it arrives.
 */
export const sendTransport = () => fallback(
  RPCS.map((url) => http(url, { timeout: 20_000, retryCount: 2, retryDelay: 400 })),
  { rank: false },
);

export { MULTICALL3 };
