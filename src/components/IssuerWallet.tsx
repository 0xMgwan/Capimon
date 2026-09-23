"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { encodeAbiParameters, keccak256, toBytes, parseAbi, type Abi } from "viem";
import { connectRoute, walletDeepLink, type WalletId } from "@/lib/wallets";

/**
 * Signing issuer transactions from the desk, with the key in a wallet.
 *
 * The issuer key creates tokens and writes the custody registry, so it never
 * goes on the server: a server key is one leaked environment variable away
 * from minting unbacked shares. Instead the desk builds each transaction and
 * the operator's own wallet — with the issuer account imported — signs it.
 *
 * Which account that is comes from the chain, not from this file: the custody
 * registry's admin() is the issuer, so a wallet that is not it is told so
 * before it can waste gas on a transaction that would revert.
 */

export const B20_FACTORY = "0xB20f000000000000000000000000000000000000" as const;
/** keccak256("MINT_ROLE"), the role a B20 token checks before minting. */
export const MINT_ROLE = "0x154c00819833dac601ee5ddded6fda79d9d8b506b911b3dbd54cdb95fe6c3686" as const;
/** keccak256("BURN_ROLE"): what burn() checks, decoded from its revert. */
export const BURN_ROLE = "0xe97b137254058bd94f28d2f3eb79e2d34074ffb488d042e3bc958e0a57d2fa22" as const;
const VARIANT_ASSET = 0;

const factoryAbi = parseAbi([
  "function createB20(uint8 variant, bytes32 salt, bytes params, bytes[] initCalls) returns (address)",
  "function getB20Address(uint8 variant, address sender, bytes32 salt) view returns (address)",
  "function isB20Initialized(address token) view returns (bool)",
]);
export const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function grantRole(bytes32 role, address account)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function totalSupply() view returns (uint256)",
]);
export const registryAbi = parseAbi([
  "function admin() view returns (address)",
  "function attestCustody(string security, string custodian, uint256 quantity, uint256 locked, uint64 expiresAt, string docRef)",
]);

type Tx = { address: `0x${string}`; abi: Abi; functionName: string; args: readonly unknown[] };

export function useIssuer(registry: string) {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: base.id });
  const [issuer, setIssuer] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !registry) return;
    client.readContract({ address: registry as `0x${string}`, abi: registryAbi, functionName: "admin" })
      .then((a) => setIssuer(String(a).toLowerCase()))
      .catch(() => setIssuer(null));
  }, [client, registry]);

  const isIssuer = !!address && !!issuer && address.toLowerCase() === issuer;

  /** Sends one transaction and waits for it, so callers get a mined hash. */
  const send = useCallback(async (tx: Tx) => {
    if (!client) throw new Error("No connection to Base.");
    if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
    // Simulated first: a revert shows its reason here rather than as spent gas.
    await client.simulateContract({ ...tx, account: address } as Parameters<typeof client.simulateContract>[0]);
    const hash = await writeContractAsync({ ...tx, chainId: base.id } as Parameters<typeof writeContractAsync>[0]);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction reverted.");
    return hash;
  }, [client, chainId, switchChainAsync, writeContractAsync, address]);

  return { address, isConnected, issuer, isIssuer, connectors, connectAsync, disconnect, send, client };
}

/** The params struct B20's factory decodes; version is a field, not a prefix. */
export function b20Params(name: string, symbol: string, admin: `0x${string}`, decimals = 8) {
  return encodeAbiParameters(
    [{ type: "tuple", components: [
      { type: "uint8" }, { type: "string" }, { type: "string" }, { type: "address" }, { type: "uint8" },
    ] }],
    [[1, name, symbol, admin, decimals]],
  );
}

export const saltFor = (tokenSymbol: string) => keccak256(toBytes(tokenSymbol));

export async function predictToken(
  client: NonNullable<ReturnType<typeof usePublicClient>>, issuer: `0x${string}`, tokenSymbol: string,
) {
  const addr = await client.readContract({
    address: B20_FACTORY, abi: factoryAbi, functionName: "getB20Address",
    args: [VARIANT_ASSET, issuer, saltFor(tokenSymbol)],
  });
  const exists = await client.readContract({
    address: B20_FACTORY, abi: factoryAbi, functionName: "isB20Initialized", args: [addr],
  });
  return { address: String(addr) as `0x${string}`, exists: Boolean(exists) };
}

export function createTokenTx(name: string, tokenSymbol: string, issuer: `0x${string}`): Tx {
  return {
    address: B20_FACTORY, abi: factoryAbi as Abi, functionName: "createB20",
    args: [VARIANT_ASSET, saltFor(tokenSymbol), b20Params(name, tokenSymbol, issuer), []],
  };
}

/** Connect / status strip shown at the top of the issuer tools. */
export function IssuerBar({ w }: { w: ReturnType<typeof useIssuer> }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border hairline px-4 py-3 text-[12px]">
      <span className="eyebrow">Issuer wallet</span>
      {!w.isConnected ? (
        <>
          {w.connectors.filter((c) => c.id === "coinbaseWalletSDK" || c.type === "injected").slice(0, 3).map((c) => (
            <button key={c.uid}
              onClick={() => {
                setErr(null);
                // No extension on a phone: open this page in the wallet's own
                // browser, where its provider exists, rather than calling a
                // connector that cannot find one.
                if (connectRoute(c.id as WalletId) === "deepLink") {
                  const link = walletDeepLink(c.id as WalletId, window.location.href);
                  if (link) { window.location.href = link; return; }
                }
                w.connectAsync({ connector: c }).catch((e) => setErr(e?.shortMessage ?? e?.message ?? "Could not connect"));
              }}
              className="rounded-full border hairline px-3 py-1.5 hover:surface">
              Connect {c.name}
            </button>
          ))}
          <span className="text-[var(--muted)]">Sign issuer actions here instead of running cast. Import the issuer account into the wallet first.</span>
        </>
      ) : (
        <>
          <span className="tnum">{w.address?.slice(0, 6)}…{w.address?.slice(-4)}</span>
          {w.isIssuer ? (
            <span className="rounded-full bg-[var(--color-up)]/10 px-2 py-0.5 text-[var(--color-up)]">issuer · can sign</span>
          ) : (
            <span className="rounded-full bg-[var(--color-down)]/10 px-2 py-0.5 text-[var(--color-down)]">
              not the issuer{w.issuer ? ` (${w.issuer.slice(0, 6)}…${w.issuer.slice(-4)})` : ""}
            </span>
          )}
          <button onClick={() => w.disconnect()} className="ml-auto text-[var(--muted)] underline">Disconnect</button>
        </>
      )}
      {err && <span className="w-full text-[var(--color-down)]">{err}</span>}
    </div>
  );
}
