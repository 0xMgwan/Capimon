"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { NtzsIcon } from "./icons/Ntzs";
import { usd, ledgerAmount } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { AssetPicker } from "./AssetPicker";
import { useDse, dseLogoOf } from "@/lib/useDse";
import { useMarkets } from "@/lib/useMarkets";
import { useVenues } from "@/lib/useVenues";
import { useT } from "@/lib/i18n";
import { AssetLogo } from "./AssetLogo";

type BankDetails = {
  institution: string | null; accountNumber: string; accountName: string | null;
  reference: string; amountTzs: number; note: string | null; expiresAt: string;
};
type Deposit = {
  id: string; amount_tzs: number; status: string; usdc_credited: string | null;
  created_at: string; settled_at: string | null;
  /** Present while a bank transfer is waiting for the money. */
  bank?: BankDetails | null;
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
export function WalletSection({ holdings }: {
  /**
   * The holdings list, rendered between the wallet and the activity feed.
   *
   * Passed in rather than placed by the page, because the money and the
   * positions it bought are one story and were reading as two: cash sat under
   * its own hero heading below the holdings, so the first thing a customer saw
   * was what they own and the last was what they could spend. Taking it as a
   * slot keeps a single instance of this component, with one set of deposit
   * state and one poll.
   */
  holdings?: React.ReactNode;
}) {
  const { t } = useT();
  const { account, refresh } = useCapimonAccount();
  const router = useRouter();
  // Buying and selling start from the same searchable list the ticket uses, so
  // choosing a company never means a trip to the markets index and back.
  const { data: marketData } = useMarkets();
  const dse = useDse();
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
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [hiddenRef, setHiddenRef] = useState<string | null>(null);
  const [payerAccount, setPayerAccount] = useState("");
  /* Payouts go to a phone or, via nTZS's FI codes, straight to a bank account. */
  const [wdTo, setWdTo] = useState<"mobile" | "bank">("mobile");
  const [wdBank, setWdBank] = useState("");
  const [wdAccount, setWdAccount] = useState("");
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([]);
  const [quote, setQuote] = useState<{ quoteId: string; feeTzs: number; recipientName: string | null; destination?: string } | null>(null);

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
    if (wdTo !== "bank" || banks.length) return;
    let alive = true;
    fetch("/api/ntzs/banks", { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (alive && j.ok) setBanks(j.banks ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, [wdTo, banks.length]);

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

  /* The newest open bank transfer, so its details survive a reload. */
  const openBankRaw = bankDetails ?? deposits.find((d) => d.bank)?.bank ?? null;
  const openBank = openBankRaw && openBankRaw.reference !== hiddenRef ? openBankRaw : null;

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
          amountTzs: amount, paymentMethod: method,
          ...(method === "mobile_money" ? { phoneNumber: phoneToUse } : { payerAccountNumber: payerAccount }),
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      if (j.bank) { setBankDetails(j.bank); setHiddenRef(null); }
      else setNotice(j.note ?? "Approve the prompt on your phone.");
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
      const dest = wdTo === "bank"
        ? `bankCode=${encodeURIComponent(wdBank)}&accountNumber=${encodeURIComponent(wdAccount)}`
        : `phoneNumber=${encodeURIComponent(phoneToUse)}`;
      const r = await fetch(`/api/ntzs/withdraw?amountTzs=${wdAmount}&${dest}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setQuote({ quoteId: j.quoteId, feeTzs: j.feeTzs ?? 0, recipientName: j.recipientName ?? null, destination: j.destination });
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
        body: JSON.stringify({
          quoteId: quote.quoteId, amountTzs: wdAmount,
          ...(wdTo === "bank" ? { bankCode: wdBank, accountNumber: wdAccount } : { phoneNumber: phoneToUse }),
        }),
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

  // No heading of its own any more. Sitting directly under "Your book" it was
  // a second title introducing the same page, and the cards say what they are.
  return (
    <section className="mt-5">

      {deposits.some((d) => IN_FLIGHT.has(d.status)) && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#b45309]/40 bg-[#b45309]/[0.06] px-4 py-3">
          <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[#b45309] border-t-transparent" />
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            A deposit is on its way. Approve the prompt on your phone if you have not already,
            your balance updates here automatically once it clears, and you can safely leave this page.
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-4">
        <div id="wallet" className="scroll-mt-24 rounded-3xl border hairline p-4 sm:p-5 lg:flex lg:items-center lg:justify-between lg:gap-8">
          {/*
            * The big number is gone.
            *
            * "Available to invest" printed the same figure as the Cash cell
            * directly above it, at three times the size — a third of a phone
            * screen spent restating something the reader had just been told,
            * which pushed the holdings and the activity below the fold. What is
            * left is the part the totals do not say: which currencies the
            * balance is actually in, since each is spent on its own.
            */}
          <div className="min-w-0 lg:flex-1">
            {(() => {
              const parts = [
                account.tzs > 0 ? TZS(account.tzs) : null,
                account.cash > 0 ? usd(account.cash) : null,
              ].filter(Boolean) as string[];
              if (!parts.length) return null;
              return (
                <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]">
                  <NtzsIcon className="h-4 w-4" />
                  <span className="tnum text-[var(--fg)]">{parts.join(" + ")}</span>
                  {parts.length > 1 && <span>{t("each spent in its own currency")}</span>}
                  {account.equity > 0 && <span>· {usd(account.equity)} {t("in shares")}</span>}
                </div>
              );
            })()}
          </div>

          <div className="mt-3 grid gap-2 lg:mt-0 lg:w-[360px] lg:shrink-0">
            <button
              onClick={() => setPanel((p) => (p === "deposit" ? "none" : "deposit"))}
              className="w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95"
            >
              {t(panel === "deposit" ? "Cancel" : "Add money")}
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
                    {t("Buy shares")}
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
                      {t("Sell shares")}
                    </button>
                  )}
                />
              ) : (
                <button
                  disabled
                  title={t("You have no shares to sell yet")}
                  className="whitespace-nowrap rounded-full border hairline py-3 text-[13px] font-medium opacity-40"
                >
                  {t("Sell shares")}
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
                {t(panel === "withdraw" ? "Cancel" : "Withdraw")}
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
                  <div className="eyebrow">{t("How you are paying")}</div>
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

                  <div className="eyebrow mt-4 flex items-center gap-1.5"><NtzsIcon className="h-3.5 w-3.5" /> {t("Amount")}</div>
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
                  {/* A bank transfer is matched by its reference, so it needs no
                      phone and no sending account — only mobile money asks. */}
                  {/* nTZS matches a bank credit by the account it came from as
                      well as the reference, so the sending account is asked. */}
                  {method === "bank_transfer" && (
                    <input
                      value={payerAccount}
                      onChange={(e) => setPayerAccount(e.target.value.replace(/[^\d]/g, ""))}
                      inputMode="numeric" placeholder={t("Bank account you are sending from")}
                      className="tnum mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                    />
                  )}
                  {method === "mobile_money" && (
                    <input
                      value={phoneToUse}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="numeric" placeholder={t("Mobile money number")}
                      className="mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                    />
                  )}
                  <button
                    onClick={deposit}
                    disabled={busy || amount < minTzs || (method === "mobile_money" && !phoneToUse)
                              || (method === "bank_transfer" && payerAccount.length < 6)}
                    className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
                  >
                    {busy
                      ? method === "bank_transfer" ? t("Preparing…") : t("Sending prompt…")
                      : method === "bank_transfer"
                        ? `${t("Get bank details for")} ${TZS(amount)}`
                        : `${t("Deposit")} ${TZS(amount)}`}
                  </button>
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                    Minimum {minTzs.toLocaleString()} TZS
                    {account.depositRoute === "ramp" && method === "mobile_money" && " on this rail"}.
                    {method === "bank_transfer" &&
                      ` ${t("Send from the account you enter above. You will get an account and a reference to pay from your bank app; it usually lands within about 10 minutes.")}`}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {openBank && panel !== "withdraw" && (
            <BankTransferCard bank={openBank} onDone={() => { setHiddenRef(openBank.reference); setBankDetails(null); }} />
          )}

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
                  <div className="flex rounded-full surface p-1">
                    {([["mobile", "Mobile money"], ["bank", "Bank"]] as const).map(([k, label]) => (
                      <button key={k} onClick={() => { setWdTo(k); setQuote(null); }}
                        className={`flex-1 rounded-full py-2 text-[13px] font-medium transition-colors ${
                          wdTo === k ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"}`}>
                        {t(label)}
                      </button>
                    ))}
                  </div>
                  <div className="eyebrow mt-4 flex items-center gap-1.5"><NtzsIcon className="h-3.5 w-3.5" /> {t(wdTo === "bank" ? "Send to a bank account" : "Send to mobile money")}</div>
                  <input
                    value={String(wdAmount)}
                    onChange={(e) => { setWdAmount(Number(e.target.value.replace(/\D/g, "")) || 0); setQuote(null); }}
                    inputMode="numeric"
                    aria-label="Amount to withdraw"
                    className="tnum mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                  {wdTo === "bank" ? (
                    <>
                      <select
                        value={wdBank} onChange={(e) => { setWdBank(e.target.value); setQuote(null); }}
                        className="mt-2 w-full rounded-xl border hairline bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                      >
                        <option value="">{t("Choose your bank")}</option>
                        {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                      </select>
                      <input
                        value={wdAccount}
                        onChange={(e) => { setWdAccount(e.target.value.replace(/[^\d]/g, "")); setQuote(null); }}
                        inputMode="numeric" placeholder={t("Account number")}
                        className="tnum mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                      />
                    </>
                  ) : (
                    <input
                      value={phoneToUse}
                      onChange={(e) => { setPhone(e.target.value); setQuote(null); }}
                      inputMode="numeric" placeholder={t("Mobile money number")}
                      className="mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                    />
                  )}

                  {quote ? (
                    <div className="mt-3 rounded-xl surface p-3 text-xs">
                      <div className="flex justify-between gap-3">
                        <span className="text-[var(--muted)]">{t("Sending to")}</span>
                        {/* Name and account both, as the BoT disclosure rule asks. */}
                        <span className="truncate text-right">
                          {quote.recipientName ?? ""}{quote.recipientName && quote.destination ? " · " : ""}
                          {quote.destination ?? phoneToUse}
                        </span>
                      </div>
                      <div className="tnum mt-1.5 flex justify-between gap-3">
                        <span className="text-[var(--muted)]">Fee</span><span>{TZS(quote.feeTzs)}</span>
                      </div>
                      <div className="tnum mt-1.5 flex justify-between gap-3 border-t hairline pt-1.5">
                        <span className="text-[var(--muted)]">{t("They receive")}</span><span>{TZS(wdAmount)}</span>
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
                      disabled={busy || wdAmount < MIN_WITHDRAW || wdAmount > account.tzs + (account.cashTzs ?? 0)
                                || (wdTo === "bank" ? !wdBank || wdAccount.length < 6 : !phoneToUse)}
                      className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
                    >
                      {busy ? "Pricing…" : "Continue"}
                    </button>
                  )}
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    Minimum {MIN_WITHDRAW.toLocaleString()} TZS. The fee is quoted by the network, not by CAPX, and confirmed the moment it is sent.
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

        {holdings}

        <div className="rounded-3xl border hairline">
          <div className="border-b hairline px-5 py-3.5">
            <span className="eyebrow">{t("Activity")}</span>
          </div>
          {deposits.length === 0 && account.entries.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-[var(--muted)]">
              {t("Nothing yet. Add money to get started.")}
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {/*
                * One list, ordered by when things happened.
                *
                * Deposits and trades were rendered as two lists one after the
                * other, so everything a customer paid in came before everything
                * they did with it no matter how long ago. A statement that
                * groups by kind instead of by time is not a statement.
                */}
              {[
                ...deposits.map((d) => ({
                  key: `d-${d.id}`,
                  at: d.created_at,
                  inFlight: IN_FLIGHT.has(d.status),
                  glyph: "↓",
                  title: t("Deposit"),
                  sub: `${STATUS_LABEL[d.status] ?? d.status}`,
                  main: TZS(d.amount_tzs),
                  extra: d.usdc_credited ? `+${usd(Number(d.usdc_credited))}` : null,
                  tone: "neutral" as const,
                  asset: null,
                })),
                /*
                 * One row per trade, not one per ledger entry.
                 *
                 * A trade writes two entries — the shares and the cash — and
                 * listing both showed a single purchase as two events, the
                 * second of which read "Paid TZS" as though shillings had been
                 * traded for something unnamed. They are paired by order id and
                 * shown as what actually happened: bought this much of this, for
                 * this much.
                 */
                ...(() => {
                  const trades = new Map<string, { at: string; kind: string; asset: string; qty: number; cash: number; price: number | null }>();
                  const loose: typeof rows = [];
                  type Row = {
                    key: string; at: string; inFlight: boolean; glyph: string; asset: string | null;
                    title: string; sub: string | null; main: string; extra: string | null;
                    tone: "up" | "down" | "neutral";
                  };
                  const rows: Row[] = [];

                  for (const e of account.entries) {
                    if (e.kind === "deposit") continue;
                    const amount = Number(e.amount);
                    const cash = e.asset === "TZS" || e.asset === "USDC";

                    if (e.orderId && (e.kind === "buy" || e.kind === "sell")) {
                      const tr = trades.get(e.orderId) ?? {
                        at: e.created_at, kind: e.kind, asset: "", qty: 0, cash: 0, price: null,
                      };
                      if (cash) tr.cash = Math.abs(amount);
                      else { tr.asset = e.asset; tr.qty = Math.abs(amount); }
                      if (e.price) tr.price = e.price;
                      // The earliest timestamp of the pair, so the trade sits
                      // where it happened rather than where it finished writing.
                      if (e.created_at < tr.at) tr.at = e.created_at;
                      trades.set(e.orderId, tr);
                      continue;
                    }
                    loose.push({
                      key: `e-${e.id}`, at: e.created_at, inFlight: false,
                      glyph: amount >= 0 ? "↗" : "↘", asset: cash ? null : e.asset,
                      title: `${e.kind[0].toUpperCase()}${e.kind.slice(1)} ${e.asset}`,
                      sub: null, main: ledgerAmount(amount, e.asset), extra: null,
                      tone: amount >= 0 ? "up" : "down",
                    });
                  }

                  for (const [id, tr] of trades) {
                    if (!tr.asset) continue;
                    const bought = tr.kind === "buy";
                    rows.push({
                      key: `t-${id}`, at: tr.at, inFlight: false,
                      glyph: bought ? "↗" : "↘", asset: tr.asset,
                      title: `${bought ? t("Bought") : t("Sold")} ${tr.asset}`,
                      sub: tr.price
                        ? `${tr.price.toLocaleString()} ${dseLogoOf(dse, tr.asset) !== undefined ? "TZS" : "USD"} a share`
                        : null,
                      main: `${bought ? "−" : "+"}${tr.cash.toLocaleString("en-TZ", { maximumFractionDigits: 2 })} TZS`,
                      extra: `${bought ? "+" : "−"}${tr.qty.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${tr.asset}`,
                      tone: bought ? "down" : "up",
                    });
                  }
                  return [...rows, ...loose];
                })(),
              ]
                .sort((a, b) => +new Date(b.at) - +new Date(a.at))
                .slice(0, 20)
                .map((row) => (
                  <div key={row.key} className="flex items-center gap-3 px-5 py-3.5">
                    {row.asset ? (
                      <AssetLogo
                        logo={dseLogoOf(dse, row.asset) !== undefined ? dseLogoOf(dse, row.asset) ?? null : marketData?.markets.find((m) => m.symbol === row.asset)?.logo ?? null}
                        ticker={row.asset}
                        color={dseLogoOf(dse, row.asset) !== undefined ? "#0B7D3E" : marketData?.markets.find((m) => m.symbol === row.asset)?.color ?? "#888"}
                        size={32}
                      />
                    ) : (
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] ${
                        row.inFlight ? "bg-[#b45309]/10 text-[#b45309]" : "surface"}`}>
                        {row.inFlight
                          ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          : row.glyph}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{row.title}</span>
                      <span className="block truncate text-[11px] text-[var(--muted)]">
                        {row.sub ? `${row.sub} · ` : ""}
                        {new Date(row.at).toLocaleString("en-GB", {
                          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`tnum block text-sm ${
                        row.tone === "up" ? "text-[var(--color-up)]"
                        : row.tone === "down" ? "text-[var(--color-down)]" : ""}`}>
                        {row.main}
                      </span>
                      {row.extra && (
                        <span className="tnum block text-[11px] text-[var(--muted)]">{row.extra}</span>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}


/**
 * Where to send a bank deposit.
 *
 * Every figure comes from the nTZS response for this deposit — the account can
 * change, and a hardcoded number would quietly send customers' money to the
 * wrong place. The reference and the exact amount are what match the transfer
 * back to this customer, so both are the loudest things on the card.
 */
function BankTransferCard({ bank, onDone }: { bank: BankDetails; onDone: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    }).catch(() => {});
  };
  const expires = new Date(bank.expiresAt);
  const rows: [string, string | null, boolean][] = [
    [t("Bank to select"), bank.institution, false],
    [t("Account number"), bank.accountNumber, true],
    [t("Account name"), bank.accountName, false],
    [t("Amount, exactly"), `${Math.round(bank.amountTzs).toLocaleString()} TZS`, true],
  ];
  return (
    <div className="mt-4 rounded-2xl border hairline p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">{t("Send a bank transfer")}</div>
        <span className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
          {t("Waiting for payment")}
        </span>
      </div>

      <div className="mt-3 rounded-xl surface p-3.5">
        <div className="eyebrow">{t("Reference · put this in the description")}</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="tnum text-2xl font-medium tracking-wide">{bank.reference}</span>
          <button
            onClick={() => copy("ref", bank.reference)}
            className="shrink-0 rounded-full border hairline px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--bg)]"
          >
            {copied === "ref" ? t("Copied") : t("Copy")}
          </button>
        </div>
      </div>

      <dl className="mt-3 divide-y divide-[var(--border)] text-sm">
        {rows.filter(([, v]) => v).map(([label, value, copyable]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2">
            <dt className="text-[var(--muted)]">{label}</dt>
            <dd className="flex min-w-0 items-center gap-2 text-right">
              <span className="tnum break-all font-medium">{value}</span>
              {copyable && (
                <button
                  onClick={() => copy(label, String(value).replace(/[^\d]/g, "") || String(value))}
                  className="shrink-0 text-[11px] text-[var(--muted)] underline underline-offset-2 hover:text-[var(--fg)]"
                >
                  {copied === label ? t("Copied") : t("Copy")}
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        {bank.note ? `${bank.note} ` : ""}
        {t("Send from any Tanzanian bank. A different amount or a missing reference cannot be matched automatically.")}{" "}
        {t("Valid until")} {expires.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
      </p>
      {/* The finishing step of the flow, so it looks like one: a real button,
          not a muted link the eye skips past under a paragraph of guidance. */}
      <button
        onClick={onDone}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-[var(--fg)] py-3 text-sm font-semibold transition-colors hover:bg-[var(--fg)] hover:text-[var(--bg)] active:scale-[0.98]"
      >
        {t("I have sent it")} <span aria-hidden>→</span>
      </button>
    </div>
  );
}
