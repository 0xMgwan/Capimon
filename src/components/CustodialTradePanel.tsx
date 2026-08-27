"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { AssetMeta } from "@/lib/assets";
import type { Market } from "@/lib/useMarkets";
import { useCapimonAccount, useCurrency } from "@/lib/useCapimonAccount";
import { UsdcIcon } from "./icons/Usdc";
import { NtzsIcon } from "./icons/Ntzs";
import { AssetPicker } from "./AssetPicker";
import { useMarkets } from "@/lib/useMarkets";
import { useVenues } from "@/lib/useVenues";
import { usd } from "@/lib/format";

type Quote = {
  ok: boolean; executable?: boolean; amountOut?: number; oracleOut: number; oraclePrice: number;
  executionPrice?: number; priceImpact?: number; severity?: string; safe?: boolean;
  venues?: string[]; fee?: { percent: number; amountUsd: number } | null; note?: string;
};

const PRESETS_USDC = [10, 50, 100, 500];
const PRESETS_TZS = [25_000, 100_000, 250_000, 500_000];

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
  const router = useRouter();
  // The same searchable list the landing page uses, so switching company from
  // inside the ticket does not mean going back to the markets index first —
  // which on a phone is a page load and a lost amount.
  const { data: marketData } = useMarkets();
  const { venues } = useVenues();
  const pickerMarkets = useMemo(() => {
    const rank = (sym: string) => (venues[sym]?.tradeable ? 0 : 1);
    return [...(marketData?.markets ?? [])].sort(
      (a, b) => rank(a.symbol) - rank(b.symbol) || a.ticker.localeCompare(b.ticker),
    );
  }, [marketData, venues]);
  const pickerSelected = pickerMarkets.find((m) => m.symbol === asset.symbol);
  const { currency, setCurrency, canShowTzs, rate, format, toUsdc } = useCurrency();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ txHash: string; qty: number; usdc: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const held = account?.positions.find((p) => p.symbol === asset.symbol)?.qty ?? 0;
  const cash = account?.cash ?? 0;
  const tzsCash = account?.tzs ?? 0;
  const amountNum = Number(amount) || 0;
  // What the user typed, expressed in USDC — the router and the quote both work
  // in USDC whatever the screen says.
  const spendUsdc = side === "buy" ? toUsdc(amountNum) : amountNum;
  /*
   * The toggle decides which balance is spent, not merely how figures are
   * shown. An account can hold both, and treating any TZS balance as "pay in
   * shillings" checked a USDC purchase against the shilling balance — a $1 buy
   * with $1.94 available refused as "Not enough TZS".
   */
  const payTzs = side === "buy" && currency === "TZS" && !!rate && rate > 0;
  const tzsToSpend = payTzs ? amountNum : 0;

  /*
   * Selling by value rather than by share count.
   *
   * People decide "cash out 50,000 shillings", not "sell 0.00874403 shares" —
   * the quantity is an artefact of the price, and with eight decimals it is
   * unreadable and easy to mistype. So the sell side takes an amount in the
   * chosen currency and converts to a quantity here, at the live mark.
   */
  const markUsd = market?.price ?? 0;
  const sellByValue = side === "sell" && markUsd > 0;
  const sellValueUsd = sellByValue ? (currency === "TZS" && rate ? amountNum * rate : amountNum) : 0;
  // Never ask to sell more than is held: a rounding error at eight decimals
  // reverts the whole trade for the sake of a fraction of a cent.
  const sellQty = sellByValue ? Math.min(held, sellValueUsd / markUsd) : amountNum;
  const heldValue = currency === "TZS" && rate ? (held * markUsd) / rate : held * markUsd;
  /*
   * The quote endpoint prices a buy in USDC and a sell in share quantity, so
   * it gets whichever the side needs. Declared after sellQty rather than beside
   * spendUsdc: a `const` cannot be read before its initialiser runs, and a
   * hoisted helper reaching back for it threw "Cannot access before
   * initialization" on every render of the panel.
   */
  const quoteAmount = side === "buy" ? spendUsdc : sellQty;

  // What is actually spendable in the currency on screen.
  const available = side !== "buy" ? (sellByValue ? heldValue : held) : payTzs ? tzsCash : cash;
  const wanted = side !== "buy" ? amountNum : payTzs ? tzsToSpend : spendUsdc;
  const insufficient = wanted > available * 1.0001; // tolerate float noise at the max

  useEffect(() => {
    if (!(quoteAmount > 0)) return;
    let alive = true;
    const t = setTimeout(async () => {
      if (!alive) return;
      setQuoting(true);
      try {
        const r = await fetch(`/api/quote?symbol=${asset.symbol}&side=${side}&amount=${quoteAmount}`, { cache: "no-store" });
        const j: Quote = await r.json();
        if (alive) setQuote(j);
      } catch {
        if (alive) setQuote(null);
      } finally {
        if (alive) setQuoting(false);
      }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [quoteAmount, side, asset.symbol, market?.price]);

  const place = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/account/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          side === "sell"
            ? { symbol: asset.symbol, side, amount: sellQty }
            : payTzs
              ? { symbol: asset.symbol, side, amount: tzsToSpend, currency: "TZS" }
              : { symbol: asset.symbol, side, amount: spendUsdc },
        ),
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
      {pickerMarkets.length > 0 && (
        <div className="mb-4">
          <div className="eyebrow mb-2">Company</div>
          <AssetPicker
            markets={pickerMarkets}
            venues={venues}
            selected={pickerSelected}
            onSelect={(ticker) => router.push(`/markets/${ticker.toLowerCase()}`)}
          />
        </div>
      )}

      <div className="flex rounded-full surface p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s); setResult(null); setError(null);
              // Both sides are money now, so the default is an amount, and
              // selling defaults to the whole position.
              setAmount(s === "buy"
                ? (currency === "TZS" ? "25000" : "100")
                : String(currency === "TZS" ? Math.floor(heldValue) : Number(heldValue.toFixed(2))));
            }}
            className={`flex-1 rounded-full py-2 text-sm font-medium capitalize transition-colors ${
              side === s ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
            }`}
          >
            {s} {asset.ticker}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <label className="eyebrow">{side === "buy" ? "You spend" : "You sell"}</label>
          {side === "buy" && canShowTzs && (
            <div className="flex rounded-full surface p-0.5">
              {(["TZS", "USDC"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    currency === c ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-1 flex justify-end">
          <button
            onClick={() => setAmount(String(side === "buy"
              ? (payTzs ? Math.floor(tzsCash) : cash)
              : currency === "TZS" ? Math.floor(heldValue) : Number(heldValue.toFixed(2))))}
            className="tnum text-[11px] text-[var(--muted)] hover:text-[var(--fg)]"
          >
            {side === "buy"
              ? `${payTzs ? `${Math.floor(tzsCash).toLocaleString()} TZS` : usd(cash)} available`
              : `${currency === "TZS" ? `${Math.floor(heldValue).toLocaleString()} TZS` : usd(heldValue)} held`}
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
            {currency === "TZS" ? <NtzsIcon className="h-4 w-4" /> : <UsdcIcon className="h-4 w-4" />}
            {currency}
          </span>
        </div>
        {(side === "buy" || sellByValue) && (
          <div className="mt-2.5 grid grid-cols-4 gap-2">
            {(currency === "TZS" ? PRESETS_TZS : PRESETS_USDC).map((p) => (
              <button
                key={p}
                onClick={() => setAmount(String(p))}
                className={`tnum rounded-full border py-2 text-[13px] font-medium transition-all active:scale-95 ${
                  amountNum === p ? "border-transparent bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                }`}
              >
                {currency === "TZS" ? `${p / 1000}k` : `$${p}`}
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
        {/* The value is what people choose; the quantity is what actually
            trades, so it stays visible rather than being hidden behind it. */}
        {sellByValue && sellQty > 0 && (
          <Row k="Shares sold" v={`${sellQty.toFixed(6)} ${asset.symbol}`} />
        )}
        <Row k="Oracle mark" v={market ? format(market.price) : "—"} />
        {quote?.executionPrice ? <Row k="Execution price" v={format(quote.executionPrice)} /> : null}
        {quote?.venues?.length ? <Row k="Route" v={quote.venues.join(" + ")} /> : null}
        {quote?.fee ? <Row k={`CAPX fee (${quote.fee.percent.toFixed(2)}%)`} v={format(quote.fee.amountUsd)} /> : null}
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
            {side === "buy" ? `Not enough ${payTzs ? "TZS" : "USDC"}` : "More than you hold"}
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
              {side === "buy" ? `Bought ${result.qty.toFixed(6)} ${asset.symbol}` : `Sold for ${format(result.usdc)}`}
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
            /* break-words matters: a revert carries an unbroken hex blob with no
               spaces, which cannot wrap and stretches the page sideways on a phone. */
            className="mt-3 overflow-hidden break-words text-xs leading-snug text-[var(--color-down)]"
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
