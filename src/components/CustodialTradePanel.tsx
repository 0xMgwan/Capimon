"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { AssetMeta } from "@/lib/assets";
import type { Market } from "@/lib/useMarkets";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { AssetLogo } from "./AssetLogo";
import { UsdcIcon } from "./icons/Usdc";
import { usd } from "@/lib/format";

type Quote = {
  ok: boolean; executable?: boolean; amountOut?: number; oracleOut: number; oraclePrice: number;
  executionPrice?: number; priceImpact?: number; severity?: string; safe?: boolean;
  venues?: string[]; fee?: { percent: number; amountUsd: number } | null; note?: string;
};

const PRESETS = [10, 50, 100, 500];

/**
 * Buying and selling for a signed-in custodial account.
 *
 * CAPX trades from its treasury and credits the account's ledger, so there
 * is no wallet, no approval and no signature — which is the whole point, and
 * also the thing the user is trusting us with. The panel says so rather than
 * letting it feel like magic.
 */
export function CustodialTradePanel({ asset, market }: { asset: AssetMeta; market?: Market }) {
  const { account, refresh } = useCapimonAccount();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ txHash: string; qty: number; usdc: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const held = account?.positions.find((p) => p.symbol === asset.symbol)?.qty ?? 0;
  const cash = account?.cash ?? 0;
  const amountNum = Number(amount) || 0;
  const insufficient = side === "buy" ? amountNum > cash : amountNum > held;

  useEffect(() => {
    if (!(amountNum > 0)) return;
    let alive = true;
    const t = setTimeout(async () => {
      if (!alive) return;
      setQuoting(true);
      try {
        const r = await fetch(`/api/quote?symbol=${asset.symbol}&side=${side}&amount=${amountNum}`, { cache: "no-store" });
        const j: Quote = await r.json();
        if (alive) setQuote(j);
      } catch {
        if (alive) setQuote(null);
      } finally {
        if (alive) setQuoting(false);
      }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [amountNum, side, asset.symbol, market?.price]);

  const place = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/account/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: asset.symbol, side, amount: amountNum }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.note ? `${j.error} ${j.note}` : j.error);
      setResult({ txHash: j.txHash, qty: j.qty, usdc: j.usdc });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Order failed");
    } finally {
      setBusy(false);
    }
  };

  const canTrade = account?.capabilities.trading !== false;
  const blocked = quote?.executable === true && quote.safe === false;
  const noRoute = quote?.executable === false;

  return (
    <div className="rounded-3xl border hairline p-5">
      <div className="flex rounded-full surface p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSide(s); setResult(null); setError(null); setAmount(s === "buy" ? "100" : String(held || 0)); }}
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
          <label className="eyebrow">{side === "buy" ? "You spend" : "You sell"}</label>
          <button
            onClick={() => setAmount(String(side === "buy" ? cash : held))}
            className="tnum text-[11px] text-[var(--muted)] hover:text-[var(--fg)]"
          >
            {side === "buy" ? `${usd(cash)} available` : `${held.toFixed(6)} held`}
          </button>
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
            {side === "buy" ? <UsdcIcon className="h-4 w-4" /> : <AssetLogo logo={market?.logo} ticker={asset.ticker} color={asset.color} size={16} />}
            {side === "buy" ? "USDC" : asset.symbol}
          </span>
        </div>
        {side === "buy" && (
          <div className="mt-2.5 grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(String(p))}
                className={`tnum rounded-full border py-2 text-[13px] font-medium transition-all active:scale-95 ${
                  amountNum === p ? "border-transparent bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                }`}
              >
                ${p}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-2xl surface px-4 py-3">
        <div className="eyebrow">You receive (est.)</div>
        <div className="tnum mt-1 flex items-baseline gap-2 text-2xl">
          {quoting ? (
            <span className="inline-block h-7 w-28 animate-pulse rounded bg-[var(--border)]" />
          ) : (
            <>
              {(quote?.amountOut ?? quote?.oracleOut ?? 0).toFixed(side === "buy" ? 6 : 2)}
              <span className="text-sm text-[var(--muted)]">{side === "buy" ? asset.symbol : "USDC"}</span>
            </>
          )}
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        <Row k="Oracle mark" v={market ? usd(market.price) : "—"} />
        {quote?.executionPrice ? <Row k="Execution price" v={usd(quote.executionPrice)} /> : null}
        {quote?.venues?.length ? <Row k="Route" v={quote.venues.join(" + ")} /> : null}
        {quote?.fee ? <Row k={`CAPX fee (${quote.fee.percent.toFixed(2)}%)`} v={`${usd(quote.fee.amountUsd)} USDC`} /> : null}
      </dl>

      <div className="mt-5">
        {!canTrade ? (
          <p className="rounded-2xl border border-dashed hairline p-4 text-xs leading-relaxed text-[var(--muted)]">
            Custodial trading is not enabled on this deployment yet.
          </p>
        ) : noRoute ? (
          <p className="rounded-2xl border border-dashed hairline p-4 text-xs leading-relaxed text-[var(--muted)]">
            {quote?.note ?? "No venue can route this trade right now."}
          </p>
        ) : blocked ? (
          <p className="rounded-2xl border border-[var(--color-down)]/45 bg-[var(--color-down)]/[0.06] p-4 text-xs leading-relaxed text-[var(--color-down)]">
            The best route is {Math.abs(quote?.priceImpact ?? 0).toFixed(1)}% from the mark. CAPX
            will not trade at that price.
          </p>
        ) : insufficient ? (
          <button disabled className="w-full rounded-full surface py-3.5 text-sm text-[var(--muted)]">
            {side === "buy" ? "Not enough USDC" : `You hold ${held.toFixed(6)}`}
          </button>
        ) : (
          <button
            onClick={place}
            disabled={busy || !(amountNum > 0)}
            className="w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
          >
            {busy ? "Placing order…" : `${side === "buy" ? "Buy" : "Sell"} ${asset.ticker}`}
          </button>
        )}
      </div>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-3 rounded-2xl border border-[var(--color-up)]/40 bg-[var(--color-up)]/[0.06] p-4"
          >
            <div className="text-sm font-medium text-[var(--color-up)]">
              {side === "buy" ? `Bought ${result.qty.toFixed(6)} ${asset.symbol}` : `Sold for ${usd(result.usdc)}`}
            </div>
            <a href={`https://basescan.org/tx/${result.txHash}`} target="_blank" rel="noreferrer"
              className="mt-1 block text-[11px] text-[var(--muted)] underline underline-offset-2">
              View the onchain trade ↗
            </a>
          </motion.div>
        )}
        {error && (
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="mt-3 text-xs leading-snug text-[var(--color-down)]"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <p className="mt-4 text-[11px] leading-relaxed text-[var(--muted)]">
        CAPX executes this trade from its treasury and credits your account — there is no wallet
        and nothing to sign, and CAPX holds the shares on your behalf.{" "}
        <Link href="/join" className="underline underline-offset-2 hover:text-[var(--fg)]">What that means</Link>.
        Not available to US persons. Nothing here is investment advice.
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className="tnum">{v}</dd>
    </div>
  );
}
