"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCapimonAccount } from "@/lib/useCapimonAccount";

/**
 * Buying and selling CRDB.
 *
 * Kept apart from the US ticket rather than folded into it. That panel's whole
 * shape is about converting shillings into dollars and living with slippage;
 * here the customer's currency is the settlement currency and the price is a
 * published mark, so there is no quote to refresh, no impact to warn about and
 * no route to choose. Reusing it would have meant explaining away four controls
 * that do not apply.
 */

type Market = {
  symbol: string; name: string; price: number; fresh: boolean;
  updatedAt: string | null; source: string | null;
  custodyShares: number; clientShares: number; availableShares: number;
  feeBps: number; tradable: boolean; haltReason: string | null;
};
type Dse = {
  close: number; change: number; changePct: number;
  tradeDate: string; high: number; low: number; volume: number;
} | null;

const tzs = new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 });
const tzs2 = new Intl.NumberFormat("en-TZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PRESETS = [5_000, 20_000, 50_000, 100_000];

/** Matches the token's precision; a finer figure would not survive settlement. */
const fmtQty = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 8 });

export function CrdbPanel() {
  const { account, refresh } = useCapimonAccount();
  const [data, setData] = useState<{ market: Market; dse: Dse } | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [raw, setRaw] = useState("");
  /** Sells can be sized either way, which is how customers actually think. */
  const [sellIn, setSellIn] = useState<"shares" | "tzs">("tzs");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/securities/crdb")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setData({ market: d.market, dse: d.dse }); })
      .catch(() => { /* the panel keeps its last good figures */ });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const m = data?.market;
  const price = m?.price ?? 0;
  const held = account?.positions.find((p) => p.symbol === "CRDB")?.qty ?? 0;
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

  const blocked =
    busy || !m?.tradable || !quote || !(quote.qty > 0) || tooMany || tooPoor || tooFew;

  async function submit() {
    if (!quote || blocked) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/security-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          side,
          amount: side === "buy" ? quote.spend : quote.qty,
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        setMsg({ tone: "bad", text: d.error ?? "That order could not be placed." });
      } else {
        setMsg({
          tone: "ok",
          text: side === "buy"
            ? `Bought ${fmtQty(d.qty)} CRDB for ${tzs.format(d.tzs)} TZS.`
            : `Sold ${fmtQty(d.qty)} CRDB for ${tzs.format(d.tzs)} TZS.`,
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
    <div className="rounded-3xl border hairline p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Image src="/crdb.jpg" alt="" width={40} height={40} className="rounded-full object-cover" />
        <div className="min-w-0">
          <div className="text-lg font-medium leading-tight">CRDB Bank Plc</div>
          <div className="text-[11px] text-[var(--muted)]">Dar es Salaam Stock Exchange</div>
        </div>
        <div className="ml-auto text-right">
          <div className="tnum text-2xl font-medium">{tzs.format(price)}</div>
          <div className="text-[11px] text-[var(--muted)]">TZS a share</div>
        </div>
      </div>

      {/* Both prices, because the gap between them is the thing worth seeing:
          the oracle is what a trade settles at, the exchange is where it came
          from, and on a day the publisher has not caught up they differ. */}
      {data?.dse && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
          <span>
            DSE close{" "}
            <span className="tnum text-[var(--fg)]">{tzs.format(data.dse.close)}</span>{" "}
            <span className={data.dse.changePct >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
              {data.dse.changePct >= 0 ? "▲" : "▼"} {Math.abs(data.dse.changePct).toFixed(2)}%
            </span>{" "}
            on {data.dse.tradeDate}
          </span>
          {data.dse.close !== price && price > 0 && (
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

      <div className="mt-5 grid grid-cols-2 gap-1 rounded-full surface p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSide(s); setRaw(""); setMsg(null); }}
            className={`rounded-full py-2 text-[13px] font-medium capitalize transition-colors ${
              side === s ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

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
              {k === "tzs" ? "By amount" : "By shares"}
            </button>
          ))}
        </div>
      )}

      <label className="mt-3 block">
        <span className="eyebrow">
          {side === "buy" ? "Spend (TZS)" : sellIn === "tzs" ? "Receive about (TZS)" : "Shares to sell"}
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
            All
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
              {f === 1 ? "All" : `${f * 100}%`}
            </button>
          ))}
        </div>
      )}

      {quote && quote.qty > 0 && (
        <dl className="mt-4 space-y-1.5 rounded-2xl surface px-4 py-3 text-[12px]">
          <Row label={side === "buy" ? "Shares" : "Shares sold"} value={`${fmtQty(quote.qty)} CRDB`} />
          <Row label="Price" value={`${tzs.format(price)} TZS`} />
          {quote.fee > 0 && (
            <Row label={`Fee (${((m?.feeBps ?? 0) / 100).toFixed(2)}%)`} value={`${tzs2.format(quote.fee)} TZS`} />
          )}
          <Row
            label={side === "buy" ? "Total cost" : "You receive"}
            value={`${tzs2.format(side === "buy" ? quote.spend : (quote as { proceeds: number }).proceeds)} TZS`}
            strong
          />
        </dl>
      )}

      {tooPoor && <Warn>Your balance is {tzs.format(tzsBalance)} TZS.</Warn>}
      {tooFew && <Warn>You hold {fmtQty(held)} CRDB.</Warn>}
      {tooMany && m && (
        <Warn>
          Only {fmtQty(m.availableShares)} CRDB available — the rest of the custody position is
          already held by other customers.
        </Warn>
      )}

      <button
        onClick={() => void submit()}
        disabled={blocked}
        className="mt-4 w-full rounded-full bg-[var(--fg)] py-3 text-[14px] font-medium text-[var(--bg)] disabled:opacity-40"
      >
        {busy ? "Placing…" : side === "buy" ? "Buy CRDB" : "Sell CRDB"}
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
        <Link href="/proof" className="underline underline-offset-2 hover:text-[var(--fg)]">
          Proof of reserves
        </Link>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
        CAPX holds the shares and your balance is a claim on them. Settlement is in nTZS
        against a custody position published on Base.
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
