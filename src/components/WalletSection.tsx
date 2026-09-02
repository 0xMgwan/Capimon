"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { UsdcIcon } from "./icons/Usdc";
import { NtzsIcon } from "./icons/Ntzs";
import { usd } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { AssetPicker } from "./AssetPicker";
import { useMarkets } from "@/lib/useMarkets";
import { useVenues } from "@/lib/useVenues";

type Deposit = {
  id: string; amount_tzs: number; status: string; usdc_credited: string | null;
  created_at: string; settled_at: string | null;
};

const TZS = (n: number) => `${Math.round(n).toLocaleString()} TZS`;
const MIN_WITHDRAW = 5_000;

/** Preset ladder starting at whichever floor the active rail imposes. */
const presetsFor = (min: number) => [min, min * 4, min * 10, min * 20].map((n) => Math.round(n / 500) * 500);

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for payment",
  uncertain: "Checking with the network",
  settled: "Added to your balance",
  failed: "Not completed",
  // Declined or ignored on the phone. Still watched server-side, so the wording
  // does not promise it can never arrive.
  expired: "Payment not completed",
};

const IN_FLIGHT = new Set(["pending", "uncertain"]);

/**
 * The wallet a shilling-funded account actually has: what is available, how to
 * add to it, and every movement in and out.
 *
 * Deposit lives here rather than only on the onboarding page — someone topping
 * up for the second time should not be sent back through a signup flow.
 */
export function WalletSection() {
  const { account, refresh } = useCapimonAccount();
  const router = useRouter();
  // Buying and selling start from the same searchable list the ticket uses, so
  // choosing a company never means a trip to the markets index and back.
  const { data: marketData } = useMarkets();
  const { venues } = useVenues();
  const buyable = useMemo(() => {
    const rank = (sym: string) => (venues[sym]?.tradeable ? 0 : 1);
    return [...(marketData?.markets ?? [])].sort(
      (a, b) => rank(a.symbol) - rank(b.symbol) || a.ticker.localeCompare(b.ticker),
    );
  }, [marketData, venues]);
  // Selling is only meaningful for what is actually held.
  const sellable = useMemo(() => {
    const held = new Set((account?.positions ?? []).map((p) => p.symbol));
    return buyable.filter((m) => held.has(m.symbol));
  }, [buyable, account?.positions]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [amountTzs, setAmountTzs] = useState(0);
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"mobile_money" | "bank_transfer">("mobile_money");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "deposit" | "withdraw">("none");
  const [wdAmount, setWdAmount] = useState(10_000);
  const [payerAccount, setPayerAccount] = useState("");
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

  const pendingCount = deposits.filter((d) => IN_FLIGHT.has(d.status)).length;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      await loadDeposits();
      await refresh();
    };
    const first = setTimeout(tick, 0);
    // Watch closely while something is in flight, idle otherwise. The server
    // credits it either way — this only decides how soon the screen catches up.
    const id = setInterval(tick, pendingCount > 0 ? 6_000 : 30_000);
    return () => { alive = false; clearTimeout(first); clearInterval(id); };
  }, [loadDeposits, refresh, pendingCount]);

  if (!account) return null;
  const phoneToUse = phone || account.user.phone || "";
  const minTzs = account.depositMinTzs ?? 500;
  const presets = presetsFor(minTzs);
  const amount = amountTzs || presets[1];
  // Shillings plus whatever the USDC leg is worth — the same total the payout
  // is priced against, so the button and the panel cannot disagree.
  const withdrawable = account.tzs + (account.cashTzs ?? 0);
  const belowMinWithdraw = withdrawable < MIN_WITHDRAW;

  const deposit = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await fetch("/api/ntzs/deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountTzs: amount, phoneNumber: phoneToUse, paymentMethod: method,
          ...(method === "bank_transfer" ? { payerAccountNumber: payerAccount } : {}),
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setNotice(j.note ?? "Approve the prompt on your phone.");
      setPanel("none");
      await loadDeposits();
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
          <h2 className="display mt-2 text-[clamp(1.35rem,3.6vw,2.4rem)]">Cash and activity.</h2>
        </div>
      </div>

      {deposits.some((d) => IN_FLIGHT.has(d.status)) && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#b45309]/40 bg-[#b45309]/[0.06] px-4 py-3">
          <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[#b45309] border-t-transparent" />
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            A deposit is on its way. Approve the prompt on your phone if you have not already —
            your balance updates here automatically once it clears, and you can safely leave this page.
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="rounded-3xl border hairline p-5">
          <div className="eyebrow">Available to invest</div>
          {(() => {
            /*
             * An account can hold shillings and USDC at once, and each is spent
             * on its own. Merging them into one "≈ N TZS" figure disagreed with
             * the trade panel, which shows the balance actually being spent —
             * so name both parts rather than only their sum.
             */
            const shillings = account.tzs + (account.cashTzs ?? 0);
            const showTzs = account.tzs > 0 || account.cashTzs !== null;
            const parts = [
              account.tzs > 0 ? TZS(account.tzs) : null,
              account.cash > 0 ? usd(account.cash) : null,
            ].filter(Boolean) as string[];
            return (
              <>
                <div className="tnum mt-2 flex items-center gap-2 text-3xl font-medium tracking-tight">
                  {showTzs && <NtzsIcon className="h-6 w-6" />}
                  {showTzs ? `≈ ${TZS(shillings)}` : usd(account.cash)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
                  {parts.length > 1 ? (
                    <span>{parts.join(" + ")} — each spent in its own currency</span>
                  ) : account.cash > 0 && showTzs ? (
                    <span className="inline-flex items-center gap-1">
                      <UsdcIcon className="h-3 w-3" />{usd(account.cash)} held — shown in shillings at today&apos;s rate
                    </span>
                  ) : null}
                  {account.equity > 0 && <span>· {usd(account.equity)} in shares</span>}
                </div>
              </>
            );
          })()}

          <div className="mt-5 grid gap-2">
            <button
              onClick={() => setPanel((p) => (p === "deposit" ? "none" : "deposit"))}
              className="w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95"
            >
              {panel === "deposit" ? "Cancel" : "Add money"}
            </button>
            <div className="grid grid-cols-3 gap-2">
              <AssetPicker
                markets={buyable}
                venues={venues}
                onSelect={(ticker) => router.push(`/markets/${ticker.toLowerCase()}`)}
                trigger={(open) => (
                  <button
                    onClick={open}
                    disabled={buyable.length === 0}
                    className="w-full whitespace-nowrap rounded-full border hairline py-3 text-center text-[13px] font-medium transition-colors hover:surface disabled:opacity-40"
                  >
                    Buy shares
                  </button>
                )}
              />
              {sellable.length > 0 ? (
                <AssetPicker
                  markets={sellable}
                  venues={venues}
                  onSelect={(ticker) => router.push(`/markets/${ticker.toLowerCase()}`)}
                  trigger={(open) => (
                    <button
                      onClick={open}
                      className="w-full whitespace-nowrap rounded-full border hairline py-3 text-center text-[13px] font-medium transition-colors hover:surface"
                    >
                      Sell shares
                    </button>
                  )}
                />
              ) : (
                <button
                  disabled
                  title="You have no shares to sell yet"
                  className="whitespace-nowrap rounded-full border hairline py-3 text-[13px] font-medium opacity-40"
                >
                  Sell shares
                </button>
              )}
              <button
                onClick={() => { setPanel((p) => (p === "withdraw" ? "none" : "withdraw")); setQuote(null); }}
                disabled={belowMinWithdraw}
                title={belowMinWithdraw
                  ? `Withdrawals start at ${MIN_WITHDRAW.toLocaleString()} TZS`
                  : undefined}
                className="whitespace-nowrap rounded-full border hairline py-3 text-[13px] font-medium transition-colors hover:surface disabled:opacity-40"
              >
                {panel === "withdraw" ? "Cancel" : "Withdraw"}
              </button>
            </div>

            {/* A disabled button needs a reason, and the reason is one line. */}
            {belowMinWithdraw && (
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Withdrawals minimum {MIN_WITHDRAW.toLocaleString()} TZS.
              </p>
            )}
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
                  <div className="eyebrow">How you are paying</div>
                  <div className="mt-2 flex rounded-full surface p-1">
                    {([["mobile_money", "Mobile money"], ["bank_transfer", "Bank"]] as const).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setMethod(k)}
                        className={`flex-1 rounded-full py-2 text-[13px] font-medium transition-colors ${
                          method === k ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="eyebrow mt-4">Amount</div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {presets.map((p) => (
                      <button
                        key={p}
                        onClick={() => setAmountTzs(p)}
                        className={`tnum rounded-full border py-2 text-[12px] font-medium transition-all active:scale-95 ${
                          amount === p ? "border-transparent bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                        }`}
                      >
                        {p >= 1000 ? `${p / 1000}k` : p}
                      </button>
                    ))}
                  </div>
                  <input
                    value={String(amount)}
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
                  {/* A bank credit arrives without its narration, so the sending
                      account is the only thing that identifies whose it is. */}
                  {method === "bank_transfer" && (
                    <input
                      value={payerAccount}
                      onChange={(e) => setPayerAccount(e.target.value)}
                      inputMode="numeric" placeholder="Bank account you are sending from"
                      className="tnum mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                    />
                  )}
                  <button
                    onClick={deposit}
                    disabled={busy || amount < minTzs || !phoneToUse
                              || (method === "bank_transfer" && !payerAccount.trim())}
                    className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
                  >
                    {busy
                      ? method === "bank_transfer" ? "Preparing…" : "Sending prompt…"
                      : `Deposit ${TZS(amount)}`}
                  </button>
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                    Minimum {minTzs.toLocaleString()} TZS
                    {account.depositRoute === "ramp" && method === "mobile_money" && " on this rail"}.
                    {method === "bank_transfer" &&
                      " Send from the account you enter above — that is how the credit is matched to you. Bank transfers settle more slowly than mobile money."}
                  </p>
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
                      disabled={busy || wdAmount < MIN_WITHDRAW || !phoneToUse || wdAmount > account.tzs + (account.cashTzs ?? 0)}
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
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] ${
                    IN_FLIGHT.has(d.status) ? "bg-[#b45309]/10 text-[#b45309]" : "surface"}`}>
                    {IN_FLIGHT.has(d.status)
                      ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      : "↓"}
                  </span>
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
