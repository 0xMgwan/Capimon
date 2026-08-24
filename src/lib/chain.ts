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

export { MULTICALL3 };
