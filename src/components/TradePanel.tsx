"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { base } from "wagmi/chains";
import { formatUnits, parseUnits, maxUint256 } from "viem";
import { b20Abi } from "@/lib/abis";
import { USDC_BASE, type AssetMeta } from "@/lib/assets";
import type { Market } from "@/lib/useMarkets";
import { usd } from "@/lib/format";
import { WalletButton } from "./WalletButton";
import { UsdcIcon } from "./icons/Usdc";

type Severity = "ok" | "elevated" | "severe" | "unusable" | "none";

type Quote = {
  ok: boolean; executable?: boolean; reason?: string; note?: string;
  amountOut?: number; oracleOut: number; oraclePrice: number;
  executionPrice?: number; priceImpact?: number; error?: string;
  severity?: Severity; safe?: boolean; overridable?: boolean;
  venues?: string[]; hops?: number; gasUsd?: number; router?: `0x${string}`;
  supply?: number; source?: "aggregator" | "aerodrome"; degraded?: boolean; pool?: string;
  feeApplied?: boolean;
  fee?: {
    bps: number; percent: number; receiver: string; token: "USDC";
    chargedOn: "input" | "output"; amountUsd: number;
  } | null;
};

const SLIPPAGE_BPS = 100; // 1%

export function TradePanel({ asset, market }: { asset: AssetMeta; market?: Market }) {
  const { address, isConnected, chainId } = useAccount();
  const params = useSearchParams();
  // Quick buy on the landing page hands its intent over as ?side=&amount=.
  const [side, setSide] = useState<"buy" | "sell">(params.get("side") === "sell" ? "sell" : "buy");
  const [amount, setAmount] = useState(() => {
    const a = Number(params.get("amount"));
    return a > 0 ? String(a) : "100";
  });
  const [fetchedQuote, setFetchedQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<Error | null>(null);
  // A cleared or invalid amount has no quote — derived, not reset in an effect.
  const quote = Number(amount) > 0 ? fetchedQuote : null;

  const quoteRouter = fetchedQuote?.router;
  const inToken = side === "buy" ? USDC_BASE : asset.token;
  const inDecimals = side === "buy" ? 6 : (market?.decimals ?? 8);
  const inSymbol = side === "buy" ? "USDC" : asset.symbol;
  const outSymbol = side === "buy" ? asset.symbol : "USDC";

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: inToken, abi: b20Abi, functionName: "balanceOf", args: [address ?? "0x0"],
    chainId: base.id, query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const router = quoteRouter;
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: inToken, abi: b20Abi, functionName: "allowance",
    args: [address ?? "0x0", router ?? "0x0000000000000000000000000000000000000000"],
    chainId: base.id, query: { enabled: !!address && !!router },
  });

  const { writeContract, data: approveHash, isPending: approving, error: approveError, reset } = useWriteContract();
  const { sendTransaction, data: swapHash, isPending: sending, error: sendError } = useSendTransaction();
  const hash = swapHash ?? approveHash;
  const isPending = approving || sending || building;
  const writeError = approveError ?? sendError ?? buildError;
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (confirmed) { void refetchBalance(); void refetchAllowance(); }
  }, [confirmed, refetchBalance, refetchAllowance]);

  // Re-quote as the user types, and again whenever the oracle mark moves.
  useEffect(() => {
    const n = Number(amount);
    if (!(n > 0)) return;
    let alive = true;
    const t = setTimeout(async () => {
      if (!alive) return;
      setQuoting(true);
      try {
        const r = await fetch(`/api/quote?symbol=${asset.symbol}&side=${side}&amount=${n}`, { cache: "no-store" });
        const j: Quote = await r.json();
        if (alive) { setFetchedQuote(j); setAcknowledged(false); }
      } catch {
        if (alive) setFetchedQuote({ ok: false, oracleOut: 0, oraclePrice: 0, error: "quote unavailable" });
      } finally {
        if (alive) setQuoting(false);
      }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [amount, side, asset.symbol, market?.price]);

  const amountNum = Number(amount) || 0;
  const bal = balance !== undefined ? Number(formatUnits(balance as bigint, inDecimals)) : undefined;
  const insufficient = bal !== undefined && amountNum > bal;
  const needsApproval =
    !!router && allowance !== undefined && amountNum > 0 &&
    (allowance as bigint) < parseUnits(amount || "0", inDecimals);
  const wrongChain = isConnected && chainId !== base.id;
  const executable = quote?.executable === true;
  const severity: Severity = quote?.severity ?? "none";
  const impact = quote?.priceImpact ?? 0;
  // A quote can be executable and still be a terrible fill; a dust pool at a
  // stale price will happily take the whole order. Never let that through on
  // the same footing as an ordinary trade.
  const blocked = executable && quote?.safe === false;
  const canOverride = blocked && quote?.overridable === true;
  const cleared = !blocked || (canOverride && acknowledged);

  const approve = () => {
    if (!router) return;
    writeContract({ address: inToken, abi: b20Abi, functionName: "approve", args: [router, maxUint256], chainId: base.id });
  };

  /**
   * The server builds the calldata against the live route; the wallet signs and
   * sends it. CAPIMON never holds keys and never submits on anyone's behalf.
   */
  const swap = async () => {
    if (!address || !cleared || !executable) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const r = await fetch("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: asset.symbol, side, amount: amountNum, sender: address, slippageBps: SLIPPAGE_BPS }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "could not build the transaction");
      sendTransaction({ to: j.to, data: j.data, value: BigInt(j.value || 0), chainId: base.id });
    } catch (e) {
      setBuildError(e instanceof Error ? e : new Error("could not build the transaction"));
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="rounded-3xl border hairline p-5">
      <div className="flex rounded-full surface p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSide(s); reset(); }}
            className={`flex-1 rounded-full py-2 text-sm font-medium capitalize transition-colors ${
              side === s ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
            }`}
          >
            {s} {asset.ticker}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <label className="eyebrow">You pay</label>
          {bal !== undefined && (
            <button onClick={() => setAmount(String(bal))} className="tnum text-[11px] text-[var(--muted)] hover:text-[var(--fg)]">
              Balance {bal.toFixed(side === "buy" ? 2 : 4)} {inSymbol}
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3 rounded-2xl border hairline px-4 py-3 focus-within:border-[var(--color-accent)]">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="tnum w-full bg-transparent text-2xl outline-none"
            placeholder="0"
          />
          <span className="flex shrink-0 items-center gap-1.5 rounded-full surface px-3 py-1.5 text-xs font-medium">
            {side === "buy" ? <UsdcIcon className="h-4 w-4" /> : <AssetDot color={asset.color} />}
            {inSymbol}
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-2xl surface px-4 py-3">
        <div className="eyebrow">
          You receive · {quote?.executable ? "quoted onchain" : "oracle-implied"}
        </div>
        <div className="tnum mt-1 flex items-baseline gap-2 text-2xl">
          {quoting ? (
            <span className="inline-block h-7 w-28 animate-pulse rounded bg-[var(--border)]" />
          ) : (
            <>
              {(quote?.amountOut ?? quote?.oracleOut ?? 0).toFixed(side === "buy" ? 6 : 2)}
              <span className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                {side === "buy" ? <AssetDot color={asset.color} /> : <UsdcIcon className="h-4 w-4" />}
                {outSymbol}
              </span>
            </>
          )}
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        <Row k="Oracle mark" v={market ? usd(market.price) : "—"} />
        {executable && (
          <>
            <Row k="Execution price" v={quote?.executionPrice ? usd(quote.executionPrice) : "—"} />
            <Row
              k="vs oracle mark"
              v={
                <span
                  className={
                    severity === "ok" ? "" : severity === "elevated"
                      ? "text-[#b45309]" : "text-[var(--color-down)]"
                  }
                >
                  {impact >= 0 ? "+" : ""}{impact.toFixed(2)}%
                </span>
              }
            />
            <Row
              k="Route"
              v={
                quote?.venues?.length
                  ? `${quote.venues.join(" + ")}${(quote.hops ?? 1) > 1 ? ` · ${quote.hops} hops` : ""}`
                  : "—"
              }
            />
            {quote?.gasUsd ? <Row k="Est. gas" v={usd(quote.gasUsd)} /> : null}
            {quote?.fee ? (
              <Row
                k={`CAPIMON fee (${quote.fee.percent.toFixed(2)}%)`}
                v={`${usd(quote.fee.amountUsd)} ${quote.fee.token}`}
              />
            ) : null}
            <Row k="Max slippage" v={`${SLIPPAGE_BPS / 100}%`} />
          </>
        )}
        <Row k="Multiplier" v={market ? `${market.multiplier.toFixed(6)} ×` : "—"} />
      </dl>

      {quote?.degraded && (
        <p className="mt-4 rounded-xl border border-dashed hairline px-3 py-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
          Aggregated routing is unavailable, so this is a direct Aerodrome quote. It is a real
          executable fill, just not split across venues.
        </p>
      )}

      <div className="mt-5">
        {/* Venue state is shown before the connect gate — no point asking for a
            wallet when there is nothing to fill against. */}
        {quote && executable && blocked ? (
          <div className="rounded-2xl border border-[var(--color-down)]/45 bg-[var(--color-down)]/[0.06] p-4">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-down)]" />
              <span className="text-sm font-medium text-[var(--color-down)]">
                {severity === "unusable" ? "This pool is unusable" : "Poor execution price"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              The best route available would fill at{" "}
              <span className="tnum">{quote.executionPrice ? usd(quote.executionPrice) : "—"}</span> against an
              oracle mark of <span className="tnum">{usd(quote.oraclePrice)}</span> — {Math.abs(impact).toFixed(1)}%
              away. The venues holding this asset are too thin at this size to fill anywhere near the mark.
            </p>
            {severity === "unusable" ? (
              <p className="mt-3 text-xs font-medium">
                CAPIMON will not route this trade. Use issuer mint and redeem instead.
              </p>
            ) : (
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-down)]"
                />
                <span>
                  I understand this fills {Math.abs(impact).toFixed(1)}% away from the mark and want to continue.
                </span>
              </label>
            )}
            <a
              href="https://coinbase.com/tokenize"
              target="_blank" rel="noreferrer"
              className="mt-4 block rounded-full border hairline py-2.5 text-center text-sm font-medium transition-colors hover:surface"
            >
              Mint or redeem with the issuer ↗
            </a>
          </div>
        ) : null}

        {blocked && !cleared ? null : quote && !executable ? (
          <div className="rounded-2xl border border-dashed hairline p-4">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted)]" />
              <span className="text-sm font-medium">No secondary market yet</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              {quote.note ??
                "No venue on Base can route this trade right now, so there is no executable secondary price."}
            </p>
            {quote.supply !== undefined && quote.supply > 0 && (
              <p className="tnum mt-3 text-[11px] text-[var(--muted)]">
                {quote.supply.toLocaleString(undefined, { maximumFractionDigits: 2 })} share-equivalents exist
                onchain — just not routable at this size.
              </p>
            )}
            <a
              href="https://coinbase.com/tokenize"
              target="_blank" rel="noreferrer"
              className="mt-4 block rounded-full bg-[var(--fg)] py-3 text-center text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02]"
            >
              Mint or redeem with the issuer ↗
            </a>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Mint and redeem are KYC-gated by the issuer. The figure above is the oracle-implied
              amount, not a fill.
            </p>
          </div>
        ) : !isConnected ? (
          <div className="[&>div>button]:w-full"><WalletButton /></div>
        ) : wrongChain ? (
          <button disabled className="w-full rounded-full bg-[var(--color-down)] py-3.5 text-sm font-medium text-white">
            Switch to Base to trade
          </button>
        ) : !quote ? (
          <button disabled className="w-full rounded-full surface py-3.5 text-sm text-[var(--muted)]">Enter an amount</button>
        ) : !cleared ? null : insufficient ? (
          <button disabled className="w-full rounded-full surface py-3.5 text-sm text-[var(--muted)]">
            Insufficient {inSymbol}
          </button>
        ) : needsApproval ? (
          <button
            onClick={approve}
            disabled={isPending || confirming}
            className="w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-60"
          >
            {approving ? "Confirm in wallet…" : confirming ? "Approving…" : `Approve ${inSymbol}`}
          </button>
        ) : (
          <button
            onClick={swap}
            disabled={isPending || confirming}
            className="w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-60"
          >
            {building ? "Finding the best route…"
              : sending ? "Confirm in wallet…"
              : confirming ? "Settling on Base…"
              : `${side === "buy" ? "Buy" : "Sell"} ${asset.ticker}`}
          </button>
        )}
      </div>

      {writeError && (
        <p className="mt-3 text-xs leading-snug text-[var(--color-down)]">
          {writeError.message.split("\n")[0]}
        </p>
      )}
      {confirmed && hash && (
        <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer"
          className="mt-3 block text-xs text-[var(--color-up)]">
          Settled onchain — view transaction ↗
        </a>
      )}

      {quote?.fee && (
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
          The {quote.fee.percent.toFixed(2)}% platform fee is already reflected in the amount above
          and is taken by the router during the swap — there is no separate approval or transaction.
        </p>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-[var(--muted)]">
        CAPIMON never takes custody. Every transaction is built in your browser and signed by your own
        wallet. Not available to US persons. Nothing here is investment advice.
      </p>
    </div>
  );
}

function AssetDot({ color }: { color: string }) {
  return <span className="h-3.5 w-3.5 rounded-full" style={{ background: color }} />;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className="tnum">{v}</dd>
    </div>
  );
}
