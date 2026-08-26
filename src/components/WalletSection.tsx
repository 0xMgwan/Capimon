"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { UsdcIcon } from "./icons/Usdc";
import { usd } from "@/lib/format";

type Deposit = {
  id: string; amount_tzs: number; status: string; usdc_credited: string | null;
  created_at: string; settled_at: string | null;
};

const TZS = (n: number) => `${Math.round(n).toLocaleString()} TZS`;
const PRESETS = [2_000, 10_000, 50_000, 100_000];
const MIN_WITHDRAW = 5_000;

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for your approval",
  uncertain: "Checking with the network",
  settled: "Added to your balance",
  failed: "Not completed",
};

/**
 * The wallet a shilling-funded account actually has: what is available, how to
 * add to it, and every movement in and out.
 *
 * Deposit lives here rather than only on the onboarding page — someone topping
 * up for the second time should not be sent back through a signup flow.
 */
export function WalletSection() {
  const { account, refresh } = useCapimonAccount();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [amountTzs, setAmountTzs] = useState(10_000);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "deposit" | "withdraw">("none");
  const [wdAmount, setWdAmount] = useState(10_000);
  const [quote, setQuote] = useState<{ quoteId: string; feeTzs: number; recipientName: string | null } | null>(null);

  const loadDeposits = useCallback(async () => {
    try {
      const r = await fetch("/api/ntzs/deposit", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setDeposits(j.deposits ?? []);
    } catch {
      /* the balance above is still accurate */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(loadDeposits, 0);
    const id = setInterval(loadDeposits, 20_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [loadDeposits]);

  if (!account) return null;
  const phoneToUse = phone || account.user.phone || "";

  const deposit = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await fetch("/api/ntzs/deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountTzs, phoneNumber: phoneToUse }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setNotice(j.note ?? "Approve the prompt on your phone.");
      setPanel("none");
      await loadDeposits();
      // Settlement is a background pass; nudge it while the user is watching.
      for (let i = 0; i < 10; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        await fetch("/api/ntzs/settle", { method: "POST" }).catch(() => {});
        await Promise.all([loadDeposits(), refresh()]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  };

  const priceWithdraw = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await fetch(`/api/ntzs/withdraw?amountTzs=${wdAmount}&phoneNumber=${encodeURIComponent(phoneToUse)}`,
        { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setQuote({ quoteId: j.quoteId, feeTzs: j.feeTzs ?? 0, recipientName: j.recipientName ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not price that withdrawal");
    } finally {
      setBusy(false);
    }
  };

  const confirmWithdraw = async () => {
    if (!quote) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/ntzs/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId, amountTzs: wdAmount, phoneNumber: phoneToUse }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.note ? `${j.error} ${j.note}` : j.error);
      setNotice(j.note ?? "Withdrawal sent.");
      setQuote(null); setPanel("none");
      await Promise.all([refresh(), loadDeposits()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Withdrawal failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Wallet</div>
          <h2 className="display mt-2 text-[clamp(1.6rem,3.6vw,2.4rem)]">Cash and activity.</h2>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="rounded-3xl border hairline p-5">
          <div className="eyebrow">Available to invest</div>
          <div className="tnum mt-2 text-3xl font-medium tracking-tight">{TZS(account.tzs)}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
            {usd(account.equity)} in shares
            {account.cash > 0 && (
              <>· <UsdcIcon className="h-3 w-3" /> {usd(account.cash)}</>
            )}
          </div>

          <div className="mt-5 grid gap-2">
            <button
              onClick={() => setPanel((p) => (p === "deposit" ? "none" : "deposit"))}
              className="w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95"
            >
              {panel === "deposit" ? "Cancel" : "Add money"}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/markets"
                className="rounded-full border hairline py-3 text-center text-sm font-medium transition-colors hover:surface"
              >
                Buy shares
              </Link>
              <button
                onClick={() => { setPanel((p) => (p === "withdraw" ? "none" : "withdraw")); setQuote(null); }}
                disabled={account.tzs < MIN_WITHDRAW}
                className="rounded-full border hairline py-3 text-sm font-medium transition-colors hover:surface disabled:opacity-40"
              >
                {panel === "withdraw" ? "Cancel" : "Withdraw"}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {panel === "deposit" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-4 border-t hairline pt-4">
                  <div className="eyebrow">Amount</div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {PRESETS.map((p) => (
                      <button
                        key={p}
                        onClick={() => setAmountTzs(p)}
                        className={`tnum rounded-full border py-2 text-[12px] font-medium transition-all active:scale-95 ${
                          amountTzs === p ? "border-transparent bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                        }`}
                      >
                        {p >= 1000 ? `${p / 1000}k` : p}
                      </button>
                    ))}
                  </div>
                  <input
                    value={String(amountTzs)}
                    onChange={(e) => setAmountTzs(Number(e.target.value.replace(/\D/g, "")) || 0)}
                    inputMode="numeric"
                    aria-label="Amount in shillings"
                    className="tnum mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                  <input
                    value={phoneToUse}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="numeric" placeholder="Mobile money number"
                    className="mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                  <button
                    onClick={deposit}
                    disabled={busy || amountTzs < 500 || !phoneToUse}
                    className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
                  >
                    {busy ? "Sending prompt…" : `Deposit ${TZS(amountTzs)}`}
                  </button>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">Minimum 500 TZS.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {panel === "withdraw" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-4 border-t hairline pt-4">
                  <div className="eyebrow">Send to mobile money</div>
                  <input
                    value={String(wdAmount)}
                    onChange={(e) => { setWdAmount(Number(e.target.value.replace(/\D/g, "")) || 0); setQuote(null); }}
                    inputMode="numeric"
                    aria-label="Amount to withdraw"
                    className="tnum mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                  <input
                    value={phoneToUse}
                    onChange={(e) => { setPhone(e.target.value); setQuote(null); }}
                    inputMode="numeric" placeholder="Mobile money number"
                    className="mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                  />

                  {quote ? (
                    <div className="mt-3 rounded-xl surface p-3 text-xs">
                      <div className="flex justify-between gap-3">
                        <span className="text-[var(--muted)]">Sending to</span>
                        <span className="truncate">{quote.recipientName ?? phoneToUse}</span>
                      </div>
                      <div className="tnum mt-1.5 flex justify-between gap-3">
                        <span className="text-[var(--muted)]">Fee</span><span>{TZS(quote.feeTzs)}</span>
                      </div>
                      <div className="tnum mt-1.5 flex justify-between gap-3 border-t hairline pt-1.5">
                        <span className="text-[var(--muted)]">They receive</span><span>{TZS(wdAmount)}</span>
                      </div>
                      <button
                        onClick={confirmWithdraw}
                        disabled={busy}
                        className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
                      >
                        {busy ? "Sending…" : "Confirm withdrawal"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={priceWithdraw}
                      disabled={busy || wdAmount < MIN_WITHDRAW || !phoneToUse || wdAmount > account.tzs}
                      className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
                    >
                      {busy ? "Pricing…" : "Continue"}
                    </button>
                  )}
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    Minimum {MIN_WITHDRAW.toLocaleString()} TZS. The fee is quoted by the network, not by CAPX.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {(notice || error) && (
            <p className={`mt-3 text-[11px] leading-relaxed ${error ? "text-[var(--color-down)]" : "text-[var(--muted)]"}`}>
              {error ?? notice}
            </p>
          )}
        </div>

        <div className="rounded-3xl border hairline">
          <div className="border-b hairline px-5 py-3.5">
            <span className="eyebrow">Activity</span>
          </div>
          {deposits.length === 0 && account.entries.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-[var(--muted)]">
              Nothing yet. Add money to get started.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {deposits.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full surface text-[11px]">↓</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Deposit</span>
                    <span className="block truncate text-[11px] text-[var(--muted)]">
                      {STATUS_LABEL[d.status] ?? d.status} ·{" "}
                      {new Date(d.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tnum block text-sm">{TZS(d.amount_tzs)}</span>
                    {d.usdc_credited && (
                      <span className="tnum block text-[11px] text-[var(--color-up)]">
                        +{usd(Number(d.usdc_credited))}
                      </span>
                    )}
                  </span>
                </div>
              ))}
              {account.entries
                .filter((e) => e.kind !== "deposit")
                .slice(0, 10)
                .map((e) => {
                  const amount = Number(e.amount);
                  return (
                    <div key={e.id} className="flex items-center gap-3 px-5 py-3.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full surface text-[11px]">
                        {e.kind === "buy" ? "↗" : e.kind === "sell" ? "↘" : "•"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium capitalize">{e.kind} {e.asset}</span>
                        <span className="block text-[11px] text-[var(--muted)]">
                          {new Date(e.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </span>
                      <span className={`tnum shrink-0 text-sm ${amount >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                        {amount >= 0 ? "+" : ""}{amount.toFixed(e.asset === "USDC" ? 2 : 6)}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
