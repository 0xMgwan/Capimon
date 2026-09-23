"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { pollWhileVisible } from "@/lib/usePoll";
import Link from "next/link";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { NtzsIcon } from "./icons/Ntzs";
import { DseLogo } from "./DseLogo";

/**
 * Buying and selling a tokenised DSE share — CRDB first, now any listing.
 *
 * Kept apart from the US ticket rather than folded into it. That panel's whole
 * shape is about converting shillings into dollars and living with slippage;
 * here the customer's currency is the settlement currency and the price is a
 * published mark, so there is no quote to refresh, no impact to warn about and
 * no route to choose. Reusing it would have meant explaining away four controls
 * that do not apply.
 */

type Market = {
  symbol: string; name: string; logo: string | null; price: number; fresh: boolean;
  updatedAt: string | null; source: string | null;
  custodyShares: number; clientShares: number; availableShares: number;
  feeBps: number; tradable: boolean; haltReason: string | null;
  kind?: "dse" | "external"; issuer?: string | null; buyOnly?: boolean;
};
type Dse = {
  price: number; live: number | null; close: number;
  change: number; changePct: number;
  tradeDate: string; high: number; low: number; volume: number;
} | null;

const tzs = new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 });
const tzs2 = new Intl.NumberFormat("en-TZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PRESETS = [5_000, 20_000, 50_000, 100_000];

/** Matches the token's precision; a finer figure would not survive settlement. */
const fmtQty = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 8 });

export function CrdbPanel({ symbol = "CRDB", showHeader = true }: {
  symbol?: string;
  /** Off on the security's own page, whose header already names it and prices it. */
  showHeader?: boolean;
}) {
  const { t } = useT();
  const { account, refresh } = useCapimonAccount();
  const [data, setData] = useState<{ market: Market; dse: Dse } | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [raw, setRaw] = useState("");
  /** Sells can be sized either way, which is how customers actually think. */
  const [sellIn, setSellIn] = useState<"shares" | "tzs">("tzs");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(() => {
    fetch(`/api/securities/${encodeURIComponent(symbol.toLowerCase())}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setData({ market: d.market, dse: d.dse }); })
      .catch(() => { /* the panel keeps its last good figures */ });
  }, [symbol]);

  /*
   * Arriving from the hero ticket with an amount already chosen.
   *
   * Read once after mount rather than through useSearchParams, which would
   * demand a Suspense boundary around the whole page for one prefill.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const amt = Number(q.get("amount"));
    // A timeout, not requestAnimationFrame: rAF never fires in a background
    // tab, and the prefill would silently not happen.
    const id = setTimeout(() => {
      if (q.get("side") === "sell") setSide("sell");
      if (amt > 0) setRaw(String(Math.round(amt)));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    load();
    const stop = pollWhileVisible(load, 60_000);
    return () => stop();
  }, [load]);

  const m = data?.market;
  const price = m?.price ?? 0;
  const held = account?.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
  const tzsBalance = account?.tzs ?? 0;

  const n = Number(raw.replace(/,/g, "")) || 0;

  /*
   * What the order will do, worked out the same way the server will.
   *
   * The fee comes off the cash leg and the share count is floored, so the
   * figures shown are the ones that settle — a preview that rounds differently
   * from the thing it previews is worse than no preview.
   */
  const quote = useMemo(() => {
    if (!(price > 0) || !(n > 0)) return null;
    const bps = m?.feeBps ?? 0;
    const floor8 = (x: number) => Math.floor(x * 1e8) / 1e8;
    const r2 = (x: number) => Math.round(x * 100) / 100;

    if (side === "buy") {
      const fee = r2((n * bps) / 10_000);
      const net = r2(n - fee);
      return { spend: r2(n), fee, qty: floor8(net / price) };
    }
    const qty = sellIn === "shares" ? floor8(n) : floor8(n / price);
    const gross = r2(qty * price);
    const fee = r2((gross * bps) / 10_000);
    return { spend: qty, fee, proceeds: r2(gross - fee), qty };
  }, [price, n, side, sellIn, m?.feeBps]);

  const tooMany = !!(side === "buy" && quote && m && quote.qty > m.availableShares);
  const tooPoor = !!(side === "buy" && quote && quote.spend > tzsBalance);
  const tooFew = !!(side === "sell" && quote && quote.qty > held);

  /* Buying needs a verified account; selling does not, so a holder is never
     trapped by a verification that lapsed after they bought. */
  const needsKyc = side === "buy" && !!account && account.user.kycStatus !== "approved";
  const blocked =
    busy || !m?.tradable || !quote || !(quote.qty > 0) || tooMany || tooPoor || tooFew || needsKyc;

  async function submit() {
    if (!quote || blocked) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/security-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          security: symbol,
          side,
          amount: side === "buy" ? quote.spend : quote.qty,
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        haptic("error");
        setMsg({ tone: "bad", text: d.error ?? "That order could not be placed." });
      } else {
        haptic("success");
        setMsg({
          tone: "ok",
          text: side === "buy"
            ? `Bought ${fmtQty(d.qty)} ${symbol} for ${tzs.format(d.tzs)} TZS.`
            : `Sold ${fmtQty(d.qty)} ${symbol} for ${tzs.format(d.tzs)} TZS.`,
        });
        setRaw("");
        await refresh();
        load();
      }
    } catch {
      setMsg({ tone: "bad", text: "Could not reach the server. Nothing was placed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border hairline p-3.5 sm:rounded-3xl sm:p-6">
      {showHeader && <div className="mb-3 flex items-center gap-3">
        <DseLogo logo={m?.logo ?? (symbol === "CRDB" ? "/crdb.jpg" : null)} symbol={symbol} size={40} />
        <div className="min-w-0">
          <div className="text-lg font-medium leading-tight">{m?.name ?? symbol}</div>
          <div className="text-[11px] text-[var(--muted)]">{t("Dar es Salaam Stock Exchange")}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="tnum text-2xl font-medium">{tzs.format(price)}</div>
          <div className="flex items-center justify-end gap-1 text-[11px] text-[var(--muted)]">
            <NtzsIcon className="h-3 w-3" /> {t("TZS a share")}
          </div>
        </div>
      </div>}

      {/* Both prices, because the gap between them is the thing worth seeing:
          the oracle is what a trade settles at, the exchange is where it came
          from, and on a day the publisher has not caught up they differ. */}
      {data?.dse && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
          <span>
            {data.dse.live !== null ? t("DSE live") : t("DSE close")}{" "}
            <span className="tnum text-[var(--fg)]">{tzs.format(data.dse.price)}</span>{" "}
            <span className={data.dse.changePct >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
              {data.dse.changePct >= 0 ? "▲" : "▼"} {Math.abs(data.dse.changePct).toFixed(2)}%
            </span>{" "}
            {data.dse.live !== null ? "" : ` on ${data.dse.tradeDate}`}
          </span>
          {data.dse.price !== price && price > 0 && (
            <span className="text-[var(--color-down)]">
              Settling at {tzs.format(price)} until the mark is refreshed.
            </span>
          )}
        </div>
      )}

      {m && !m.tradable && (
        <p className="mt-4 rounded-xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/[0.06] px-3 py-2 text-[12px] text-[var(--color-down)]">
          {m.haltReason}
        </p>
      )}

      {/*
        * No sell side while the venue does not buy back.
        *
        * A tokenised IPO is subscription-only until allocation completes;
        * offering a Sell tab that always refuses would be worse than saying
        * plainly that selling opens later.
        */}
      {/* The page header carries this notice already; two of them is nagging. */}
      {m?.buyOnly ? (showHeader ? (
        <p className="mt-4 rounded-xl border border-[#b45309]/35 bg-[#b45309]/[0.06] px-3 py-2 text-[12px] leading-snug text-[var(--muted)]">
          <span className="font-medium text-[var(--fg)]">{t("Buying only for now.")}</span>{" "}
          {t("Selling opens when the offer closes and allocation completes.")}
        </p>
      ) : null) : (
      <div className="mt-5 grid grid-cols-2 gap-1 rounded-full surface p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSide(s); setRaw(""); setMsg(null); }}
            className={`rounded-full py-2 text-[13px] font-medium capitalize transition-colors ${
              side === s ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {t(s === "buy" ? "Buy" : "Sell")}
          </button>
        ))}
      </div>
      )}

      {side === "sell" && (
        <div className="mt-3 flex gap-1 text-[11px]">
          {(["tzs", "shares"] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setSellIn(k); setRaw(""); }}
              className={`rounded-full border px-3 py-1 ${
                sellIn === k ? "border-[var(--fg)]" : "hairline text-[var(--muted)]"
              }`}
            >
              {t(k === "tzs" ? "By amount" : "By shares")}
            </button>
          ))}
        </div>
      )}

      <label className="mt-3 block">
        <span className="eyebrow">
          {t(side === "buy" ? "Spend (TZS)" : sellIn === "tzs" ? "Receive about (TZS)" : "Shares to sell")}
        </span>
        <input
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder={side === "buy" ? "20000" : sellIn === "tzs" ? "20000" : "1"}
          className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-3 text-lg tnum outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      {side === "buy" ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setRaw(String(p))}
              className="rounded-full border hairline px-3 py-1 text-[11px] hover:surface"
            >
              {tzs.format(p)}
            </button>
          ))}
          <button
            onClick={() => setRaw(String(Math.floor(tzsBalance)))}
            disabled={!(tzsBalance > 0)}
            className="rounded-full border hairline px-3 py-1 text-[11px] hover:surface disabled:opacity-40"
          >
            {t("All")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[0.25, 0.5, 1].map((f) => (
            <button
              key={f}
              onClick={() =>
                setRaw(String(sellIn === "shares"
                  ? Math.floor(held * f * 1e8) / 1e8
                  : Math.floor(held * f * price)))
              }
              disabled={!(held > 0)}
              className="rounded-full border hairline px-3 py-1 text-[11px] hover:surface disabled:opacity-40"
            >
              {f === 1 ? t("All") : `${f * 100}%`}
            </button>
          ))}
        </div>
      )}

      {quote && quote.qty > 0 && (
        <dl className="mt-4 space-y-1.5 rounded-2xl surface px-4 py-3 text-[12px]">
          <Row label={t(side === "buy" ? "Shares" : "Shares sold")} value={`${fmtQty(quote.qty)} ${symbol}`} />
          <Row label={t("Price")} value={`${tzs.format(price)} TZS`} />
          {quote.fee > 0 && (
            <Row label={`Fee (${((m?.feeBps ?? 0) / 100).toFixed(2)}%)`} value={`${tzs2.format(quote.fee)} TZS`} />
          )}
          <Row
            label={t(side === "buy" ? "Total cost" : "You receive")}
            value={`${tzs2.format(side === "buy" ? quote.spend : (quote as { proceeds: number }).proceeds)} TZS`}
            strong
          />
        </dl>
      )}

      {/* Saying the balance is short and leaving it there makes the customer
          find the way to fix it. The fix is one tap away, so offer it. */}
      {tooPoor && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[12px] text-[var(--color-down)]">
            {t("Your balance is")} {tzs.format(tzsBalance)} TZS. {t("You need")}{" "}
            {tzs.format(Math.max(0, quote!.spend - tzsBalance))} TZS {t("more.")}
          </span>
          <Link
            href="/portfolio#wallet"
            className="rounded-full border hairline px-3 py-1 text-[12px] font-medium transition-colors hover:surface"
          >
            {t("Add money")}
          </Link>
        </div>
      )}
      {needsKyc && (
        <p className="mt-3 rounded-xl border border-[#b45309]/35 bg-[#b45309]/[0.06] px-3 py-2 text-[12px] leading-snug text-[var(--muted)]">
          <span className="font-medium text-[var(--fg)]">
            {t(account!.user.kycStatus === "pending" ? "Verification under review." : "Verify your identity to buy.")}
          </span>{" "}
          {account!.user.kycStatus === "pending"
            ? t("You can buy as soon as it is approved. Selling stays open.")
            : <>
                {t("It takes a few minutes.")}{" "}
                <Link href="/verify" className="underline underline-offset-2">{t("Verify now")}</Link>
              </>}
        </p>
      )}
      {tooFew && <Warn>You hold {fmtQty(held)} {symbol}.</Warn>}
      {tooMany && m && (
        <Warn>
          Only {fmtQty(m.availableShares)} {symbol} available. The rest of the custody position is
          already held by other customers.
        </Warn>
      )}

      <button
        onClick={() => void submit()}
        disabled={blocked}
        className="mt-4 w-full rounded-full bg-[var(--fg)] py-3 text-[14px] font-medium text-[var(--bg)] disabled:opacity-40"
      >
        {busy ? t("Placing…") : `${t(side === "buy" ? "Buy" : "Sell")} ${symbol}`}
      </button>

      {msg && (
        <p className={`mt-3 text-[12px] ${msg.tone === "ok" ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
          {msg.text}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t hairline pt-3 text-[11px] text-[var(--muted)]">
        <span>
          {m ? `${fmtQty(m.availableShares)} of ${fmtQty(m.custodyShares)} shares available` : "—"}
        </span>
        <Link href={`/proof#${symbol.toLowerCase()}`} className="underline underline-offset-2 hover:text-[var(--fg)]">
          {t("Proof of reserves")}
        </Link>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
        {m?.kind === "external"
          ? `CAPX buys and holds ${m.issuer ? `${m.issuer}'s token` : "the token"}, and your balance is a claim on it. What CAPX holds is public on Base.`
          : "CAPX holds the shares and your balance is a claim on them. Settlement is in nTZS against a custody position published on Base."}
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className={`tnum ${strong ? "font-medium text-[var(--fg)]" : ""}`}>{value}</dd>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[12px] text-[var(--color-down)]">{children}</p>;
}
