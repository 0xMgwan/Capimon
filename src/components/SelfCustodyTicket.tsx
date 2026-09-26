"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useSignMessage, useWriteContract, usePublicClient } from "wagmi";
import { base } from "wagmi/chains";
import { b20Abi } from "@/lib/abis";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { WalletButton } from "./WalletButton";

/**
 * The same trade, delivered to a wallet instead of an account.
 *
 * Not a separate desk — this is the destination half of the shilling ticket.
 * The share, the price and the fee are identical to the custodial side; what
 * changes is where it ends up and therefore what it is paid for with. A wallet
 * pays in USDC, because that is what a wallet holds.
 *
 * Three things have to be true before CAPX will send a share to an address,
 * and all three are checked again on the server: there is a CAPX account, it
 * is verified, and this address has been signed for. The signature is what
 * makes the verification mean anything — anyone can type an address, and only
 * the person holding its key can sign for it.
 *
 * The order of the legs is deliberate and stated plainly on screen: the
 * customer pays first and CAPX sends against a receipt it has read itself.
 * There is no escrow contract here, so somebody has to go first, and it should
 * be the side that can see what happened.
 */

type Quote = {
  reference: string; security: string; side: "buy" | "sell";
  qty: number; priceTzs: number; usdPerTzs: number;
  netUsdc: number; feeUsdc: number;
  payTo: `0x${string}`; payToken: `0x${string}`; payDecimals: number;
  payAmount: string; expiresAt: string;
};

type Step = "idle" | "quoting" | "quoted" | "paying" | "settling" | "done";

const usd = (n: number) => `$${n.toFixed(2)}`;
const qtyFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 8 });

export function SelfCustodyTicket({ symbol, priceTzs, side }: {
  symbol: string;
  priceTzs: number;
  side: "buy" | "sell";
}) {
  const { t } = useT();
  const { account } = useCapimonAccount();
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();

  const [linked, setLinked] = useState<string[] | null>(null);
  const [free, setFree] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<{ qty: number; tx: string } | null>(null);

  const loadLinks = useCallback(async () => {
    if (!account) { setLinked([]); return; }
    try {
      const r = await fetch("/api/self/link", { cache: "no-store" });
      const j = await r.json();
      setLinked(j.ok ? j.wallets.map((w: { address: string }) => w.address.toLowerCase()) : []);
    } catch { setLinked([]); }
  }, [account]);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  /* How much is left to sell into self-custody. Public, and worth knowing up front. */
  useEffect(() => {
    let alive = true;
    fetch(`/api/self/order?security=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setFree(j.available); })
      .catch(() => { /* the figure is a courtesy, not a gate */ });
    return () => { alive = false; };
  }, [symbol]);

  const isLinked = !!address && !!linked?.includes(address.toLowerCase());
  const wrongChain = isConnected && chainId !== base.id;

  const link = async () => {
    if (!address) return;
    setError(null);
    try {
      const start = await (await fetch("/api/self/link", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      })).json();
      if (!start.ok) throw new Error(start.error);

      const signature = await signMessageAsync({ message: start.message });

      const done = await (await fetch("/api/self/link", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature }),
      })).json();
      if (!done.ok) throw new Error(done.error);
      haptic("success");
      await loadLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not link that wallet"));
    }
  };

  const getQuote = async () => {
    setStep("quoting"); setError(null); setSettled(null);
    try {
      const r = await fetch("/api/self/order", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, security: symbol, side, amount: Number(amount) }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setQuote(j.quote);
      setStep("quoted");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not price that"));
      setStep("idle");
    }
  };

  /**
   * Pay, then present the receipt.
   *
   * The hash is all the client sends: the server re-reads which token moved,
   * from whom, to whom and how much out of the receipt itself, because a page
   * that can name its own payment can name a larger one.
   */
  const payAndSettle = async () => {
    if (!quote) return;
    setStep("paying"); setError(null);
    try {
      const txHash = await writeContractAsync({
        address: quote.payToken,
        abi: b20Abi,
        functionName: "transfer",
        args: [quote.payTo, BigInt(quote.payAmount)],
      });
      setStep("settling");
      await client?.waitForTransactionReceipt({ hash: txHash });

      const r = await fetch("/api/self/order", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, reference: quote.reference, txHash }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      haptic("success");
      setSettled({ qty: j.order.qty, tx: j.order.settleTx });
      setStep("done");
      setQuote(null);
      setAmount("");
    } catch (e) {
      haptic("error");
      const msg = e instanceof Error ? e.message : t("That did not go through");
      // A wallet's own rejection is not an error worth dressing up.
      setError(/user rejected|denied/i.test(msg) ? t("You cancelled that in your wallet.") : msg);
      setStep(quote ? "quoted" : "idle");
    }
  };

  /* ------------------------------------------------------------- gates -- */

  if (!account) {
    return (
      <Gate>
        {t("Delivering to your own wallet needs a verified CAPX account. Sign in, or open one — it takes a few minutes.")}
      </Gate>
    );
  }
  if (account.user.kycStatus !== "approved") {
    return (
      <Gate>
        {account.user.kycStatus === "pending"
          ? t("Your verification is under review. You can trade into your own wallet once it is approved.")
          : t("Verify your identity to trade into your own wallet.")}{" "}
        <Link href="/verify" className="underline underline-offset-2">{t("Verify")}</Link>
      </Gate>
    );
  }
  if (!isConnected) {
    return (
      <div className="mt-4 rounded-2xl surface p-4">
        <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">
          {t("Connect the wallet you want the shares delivered to.")}
        </p>
        <div className="mt-3"><WalletButton /></div>
      </div>
    );
  }
  if (wrongChain) {
    return <Gate>{t("Switch your wallet to Base to continue.")}</Gate>;
  }
  if (linked === null) {
    return <div className="mt-4 h-24 animate-pulse rounded-2xl surface" />;
  }
  if (!isLinked) {
    return (
      <div className="mt-4 rounded-2xl surface p-4">
        <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">
          {t("Sign a message to prove this wallet is yours. It approves nothing and cannot move funds — it is how CAPX knows which verified customer this address belongs to.")}
        </p>
        <p className="tnum mt-2 truncate text-[11px] text-[var(--muted)]">{address}</p>
        <button
          onClick={() => { haptic(); void link(); }}
          className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-[13px] font-medium text-[var(--bg)] active:scale-95"
        >
          {t("Link this wallet")}
        </button>
        {error && <p className="mt-2 text-[12px] text-[var(--color-down)]">{error}</p>}
      </div>
    );
  }

  /* -------------------------------------------------------------- form -- */

  const label = side === "buy" ? t("You pay, in USDC") : t("Shares to sell");
  const n = Number(amount) || 0;

  return (
    <div className="mt-4">
      <div className="rounded-2xl surface px-3.5 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
        {side === "buy"
          ? t("The shares are sent to your wallet on Base. CAPX is the counterparty — the price is the same published DSE mark, converted at the nTZS rate.")
          : t("Send the shares back to CAPX and USDC comes to your wallet, at the same published mark.")}
        {side === "buy" && free !== null && (
          <span className="mt-1 block text-[var(--fg)]">
            {qtyFmt(free)} {symbol} {t("available to self-custody")}
          </span>
        )}
      </div>

      <label className="mt-3 block">
        <span className="eyebrow">{label}</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); setQuote(null); setStep("idle"); }}
          placeholder={side === "buy" ? "50" : "1"}
          className="tnum mt-1.5 w-full rounded-xl border hairline bg-transparent px-4 py-3 text-lg outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      {/* What it comes to, before anything is signed. */}
      {quote && (
        <div className="mt-3 grid gap-1.5 rounded-2xl border hairline p-3.5 text-[12.5px]">
          <Row label={t("Shares")} value={`${qtyFmt(quote.qty)} ${symbol}`} />
          <Row label={t("Price")} value={`${quote.priceTzs.toLocaleString()} TZS`} />
          <Row label={t("Fee")} value={usd(quote.feeUsdc)} />
          <Row
            label={side === "buy" ? t("You send") : t("You receive")}
            value={usd(quote.netUsdc)}
            strong
          />
          <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
            {t("You pay first, then CAPX sends. Both legs are on Base and you will see each one in your wallet.")}
          </p>
        </div>
      )}

      {settled && (
        <div className="mt-3 rounded-2xl border border-[var(--color-up)]/40 bg-[var(--color-up)]/[0.06] p-3.5 text-[12.5px]">
          <p className="font-medium">
            {side === "buy"
              ? `${qtyFmt(settled.qty)} ${symbol} ${t("is in your wallet.")}`
              : t("Your USDC is on its way.")}
          </p>
          {settled.tx && (
            <a href={`https://basescan.org/tx/${settled.tx}`} target="_blank" rel="noreferrer"
              className="tnum mt-1 block truncate text-[11px] text-[var(--muted)] underline underline-offset-2">
              {settled.tx}
            </a>
          )}
        </div>
      )}

      <button
        onClick={() => { haptic(); void (quote ? payAndSettle() : getQuote()); }}
        disabled={!(n > 0) || step === "quoting" || step === "paying" || step === "settling"}
        className="mt-3 w-full rounded-full bg-[var(--fg)] py-3.5 text-[13px] font-medium text-[var(--bg)] transition-transform active:scale-95 disabled:opacity-40"
      >
        {step === "quoting" ? t("Pricing…")
          : step === "paying" ? t("Confirm in your wallet…")
          : step === "settling" ? t("Settling…")
          : quote ? (side === "buy" ? `${t("Pay")} ${usd(quote.netUsdc)}` : `${t("Send")} ${qtyFmt(quote.qty)} ${symbol}`)
          : t("Get a price")}
      </button>

      {error && <p className="mt-2 text-[12px] leading-snug text-[var(--color-down)]">{error}</p>}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`tnum ${strong ? "text-[14px] font-medium" : ""}`}>{value}</span>
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-2xl surface px-3.5 py-3 text-[12.5px] leading-relaxed text-[var(--muted)]">
      {children}
    </p>
  );
}
