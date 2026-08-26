import "server-only";
import { createWalletClient, http, formatUnits, parseUnits, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { publicClient } from "./chain";
import { b20Abi } from "./abis";
import { ASSETS, USDC_BASE, BY_SYMBOL } from "./assets";
import { getRoute, buildRoute } from "./aggregator";
import { feeParams } from "./fees";
import { getMarkets } from "./markets";

/**
 * The omnibus treasury that holds custodial client assets.
 *
 * This wallet controls other people's money. The key is read from the
 * environment and never logged, returned, or exposed through any route — but an
 * environment variable is the weakest acceptable home for it. Before this holds
 * meaningful balances the signer should move behind a KMS or HSM with a signing
 * policy, which is why every signature goes through `signer()` rather than
 * touching the key directly.
 */

// Accept the key with or without the 0x prefix, and tolerate the whitespace a
// dashboard paste tends to bring with it. A key that is present but rejected on
// a formatting technicality is a confusing failure at trade time.
const RAW_KEY = (process.env.TREASURY_PRIVATE_KEY ?? "").trim().replace(/^["']|["']$/g, "");
const NORMALISED = RAW_KEY && !RAW_KEY.startsWith("0x") && /^[0-9a-fA-F]{64}$/.test(RAW_KEY)
  ? `0x${RAW_KEY}`
  : RAW_KEY;

export const treasuryConfigured = /^0x[0-9a-fA-F]{64}$/.test(NORMALISED);

/** Why the key was rejected, without ever revealing any of it. */
export function treasuryDiagnosis() {
  if (treasuryConfigured) return null;
  if (!RAW_KEY) return "TREASURY_PRIVATE_KEY is not set on this deployment.";
  const hex = NORMALISED.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]*$/.test(hex)) return "The value contains non-hexadecimal characters.";
  return `Expected 64 hex characters, received ${hex.length}.`;
}

/** Refuse to route an order more than this far from the oracle mark. */
const UNUSABLE_IMPACT = 15;

/** Sweep a little more than the order needs, so small buys stop sweeping every time. */
const SWEEP_HEADROOM = 1.25;

function signer() {
  if (!treasuryConfigured) throw new Error("TREASURY_PRIVATE_KEY is not configured");
  const account = privateKeyToAccount(NORMALISED as `0x${string}`);
  return {
    account,
    wallet: createWalletClient({
      account,
      chain: base,
      transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
    }),
  };
}

export function treasuryAddress(): `0x${string}` | null {
  return treasuryConfigured ? signer().account.address : null;
}

async function ensureAllowance(token: `0x${string}`, spender: `0x${string}`, needed: bigint) {
  const { account, wallet } = signer();
  const allowance = (await publicClient.readContract({
    address: token, abi: b20Abi, functionName: "allowance", args: [account.address, spender],
  })) as bigint;
  if (allowance >= needed) return null;

  const hash = await wallet.writeContract({
    address: token, abi: b20Abi, functionName: "approve", args: [spender, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export type Execution = {
  txHash: `0x${string}`;
  qty: number;
  usdc: number;
  price: number;
  venues: string[];
  impact: number;
};

/**
 * Buys shares into the treasury on a user's behalf and reports exactly what
 * filled. The caller credits the ledger from these numbers — never from the
 * quote, because the fill is what actually happened.
 */
export async function executeBuy(symbol: string, usdcAmount: number): Promise<Execution> {
  const asset = BY_SYMBOL[symbol.toLowerCase()];
  if (!asset) throw new Error(`unknown asset ${symbol}`);
  const { account, wallet } = signer();

  // Backing can sit in the nTZS float, but only the treasury can sign a trade,
  // so top it up first rather than failing.
  await ensureTreasuryFunded(usdcAmount, account.address);

  const markets = await getMarkets({ depth: 2 });
  const market = markets.find((m) => m.symbol === asset.symbol)!;
  const amountIn = parseUnits(usdcAmount.toFixed(6), 6);

  const route = await getRoute(USDC_BASE, asset.token, amountIn, feeParams("buy"));
  if (!route) throw new Error("no route available for this asset");

  const expectedQty = usdcAmount / market.price;
  const qtyOut = Number(formatUnits(BigInt(route.routeSummary.amountOut), market.decimals));
  const impact = expectedQty > 0 ? ((qtyOut - expectedQty) / expectedQty) * 100 : 0;
  if (Math.abs(impact) >= UNUSABLE_IMPACT) {
    throw new Error(`route is ${impact.toFixed(1)}% from the oracle mark — refusing to trade`);
  }

  await ensureAllowance(USDC_BASE, route.routerAddress, amountIn);

  const before = (await publicClient.readContract({
    address: asset.token, abi: b20Abi, functionName: "balanceOf", args: [account.address],
  })) as bigint;

  const built = await buildRoute(route, account.address, 100);
  const txHash = await wallet.sendTransaction({
    to: built.routerAddress,
    data: built.data,
    value: BigInt(built.transactionValue || 0),
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Credit what the chain says arrived, not what the quote promised.
  const after = (await publicClient.readContract({
    address: asset.token, abi: b20Abi, functionName: "balanceOf", args: [account.address],
  })) as bigint;
  const qty = Number(formatUnits(after - before, market.decimals)) * market.multiplier;

  return { txHash, qty, usdc: usdcAmount, price: qty > 0 ? usdcAmount / qty : 0,
    venues: route.venues, impact };
}

/** Sells a user's shares back to USDC. Mirror of the buy path. */
export async function executeSell(symbol: string, qty: number): Promise<Execution> {
  const asset = BY_SYMBOL[symbol.toLowerCase()];
  if (!asset) throw new Error(`unknown asset ${symbol}`);
  const { account, wallet } = signer();

  const markets = await getMarkets({ depth: 2 });
  const market = markets.find((m) => m.symbol === asset.symbol)!;
  const amountIn = parseUnits((qty / market.multiplier).toFixed(market.decimals), market.decimals);

  const route = await getRoute(asset.token, USDC_BASE, amountIn, feeParams("sell"));
  if (!route) throw new Error("no route available for this asset");

  const expectedUsdc = qty * market.price;
  const usdcOut = Number(formatUnits(BigInt(route.routeSummary.amountOut), 6));
  const impact = expectedUsdc > 0 ? ((usdcOut - expectedUsdc) / expectedUsdc) * 100 : 0;
  if (Math.abs(impact) >= UNUSABLE_IMPACT) {
    throw new Error(`route is ${impact.toFixed(1)}% from the oracle mark — refusing to trade`);
  }

  await ensureAllowance(asset.token, route.routerAddress, amountIn);

  const before = (await publicClient.readContract({
    address: USDC_BASE, abi: b20Abi, functionName: "balanceOf", args: [account.address],
  })) as bigint;

  const built = await buildRoute(route, account.address, 100);
  const txHash = await wallet.sendTransaction({
    to: built.routerAddress,
    data: built.data,
    value: BigInt(built.transactionValue || 0),
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  const after = (await publicClient.readContract({
    address: USDC_BASE, abi: b20Abi, functionName: "balanceOf", args: [account.address],
  })) as bigint;
  const usdc = Number(formatUnits(after - before, 6));

  return { txHash, qty, usdc, price: qty > 0 ? usdc / qty : 0, venues: route.venues, impact };
}

/** What the treasury actually holds onchain, for the solvency comparison. */
export async function treasuryHoldings() {
  const address = treasuryAddress();
  if (!address) return null;

  const [usdc, shares] = await Promise.all([
    publicClient.readContract({ address: USDC_BASE, abi: b20Abi, functionName: "balanceOf", args: [address] }),
    publicClient.multicall({
      contracts: ASSETS.map((a) => ({
        address: a.token, abi: b20Abi, functionName: "scaledBalanceOf", args: [address],
      } as const)),
      allowFailure: true,
    }),
  ]);

  const markets = await getMarkets({ depth: 2 });
  const holdings = ASSETS.map((a, i) => {
    const m = markets.find((x) => x.symbol === a.symbol)!;
    const raw = shares[i].status === "success" ? (shares[i].result as bigint) : 0n;
    return { asset: a.symbol, qty: Number(formatUnits(raw, m.decimals)) };
  }).filter((h) => h.qty > 0);

  return { address, usdc: Number(formatUnits(usdc as bigint, 6)), holdings };
}

/* --------------------------------------------------------------- funding -- */

/**
 * Sends USDC from the treasury back to nTZS.
 *
 * This is the direction the key can do unaided: the treasury is an ordinary EOA
 * and signing an ERC-20 transfer out of it is exactly what a private key is
 * for. Pulling the other way needs the nTZS API, because that address belongs
 * to nTZS. Withdrawals rely on this leg to put shillings back within reach of a
 * payout.
 */
export async function sendUsdcToNtzs(usdc: number, ntzsAddress: `0x${string}`) {
  const { account, wallet } = signer();
  const amount = parseUnits(usdc.toFixed(6), 6);

  const balance = (await publicClient.readContract({
    address: USDC_BASE, abi: b20Abi, functionName: "balanceOf", args: [account.address],
  })) as bigint;
  if (balance < amount) {
    throw new Error(
      `The treasury holds ${Number(formatUnits(balance, 6)).toFixed(2)} USDC and this needs ${usdc.toFixed(2)}.`,
    );
  }

  const hash = await wallet.writeContract({
    address: USDC_BASE, abi: b20Abi, functionName: "transfer", args: [ntzsAddress, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Makes sure the treasury holds enough USDC to place an order, pulling from the
 * nTZS side when it does not.
 *
 * The treasury key can sign transactions from the treasury; it cannot move
 * funds out of an address nTZS controls, which is where an on-ramp delivers.
 * The only way across that boundary is the nTZS transfers endpoint, so the
 * sweep goes through the API rather than through the key.
 */
export async function ensureTreasuryFunded(needUsdc: number, address?: `0x${string}`) {
  const to = address ?? treasuryAddress();
  if (!to) throw new Error("No treasury is configured.");

  const read = async () =>
    Number(formatUnits(
      (await publicClient.readContract({
        address: USDC_BASE, abi: b20Abi, functionName: "balanceOf", args: [to],
      })) as bigint, 6));

  let onHand = await read();
  if (onHand >= needUsdc) return { swept: 0, onHand };

  const { ntzsAvailableUsdc, sweepToTreasury } = await import("./ntzsFunding");
  const available = await ntzsAvailableUsdc();
  const shortfall = needUsdc - onHand;

  if (available < shortfall) {
    throw new Error(
      `This order needs ${needUsdc.toFixed(2)} USDC. The treasury holds ${onHand.toFixed(2)} ` +
      `and only ${available.toFixed(2)} is available on the nTZS side.`,
    );
  }

  // Pull a little extra so a run of small orders does not sweep every time.
  const amount = Math.min(available, Math.max(shortfall * SWEEP_HEADROOM, shortfall));
  await sweepToTreasury(amount, to);

  // Confirm it actually landed before trading on the assumption that it did.
  for (let i = 0; i < 10 && onHand < needUsdc; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    onHand = await read();
  }
  if (onHand < needUsdc) {
    throw new Error(
      `Swept ${amount.toFixed(2)} USDC from nTZS but the treasury still shows ${onHand.toFixed(2)}. ` +
      `Nothing was traded — check the transfer before retrying.`,
    );
  }
  return { swept: amount, onHand };
}
