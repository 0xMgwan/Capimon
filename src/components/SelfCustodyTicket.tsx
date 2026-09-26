"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage, useWriteContract, usePublicClient, useReadContract } from "wagmi";
import { base } from "wagmi/chains";
import { formatUnits } from "viem";
import { b20Abi } from "@/lib/abis";
import { USDC_BASE } from "@/lib/assets";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { WalletButton } from "./WalletButton";

/**
 * The same trade, paid for in dollars and delivered to a wallet.
 *
 * Not a separate desk — this is the USDC half of the shilling ticket, and it
 * is laid out to match it line for line: an amount, the same presets, the
 * same four-row summary, the same single button. Somebody switching currency
 * should recognise the ticket they were already looking at.
 *
 * The figures are worked out here from the mark and the rate the server
 * publishes, the same way the shilling side previews its own order, so the
 * numbers move as you type rather than after a round trip. A quote is only
 * asked for when the order is actually placed, because a quote reserves
 * inventory and nobody should be holding shares against a number they are
 * still typing.
 *
 * Everything that gates the trade is expressed through the button rather than
 * through a paragraph where the ticket used to be. "Complete verification
 * first" is an instruction; a wall of explanation where the amount field was
 * is a dead end.
 */

type Marks = { available: number; priceTzs: number; usdPerTzs: number; usdPerShare: number; feeBps: number };

type Quote = {
  reference: string; security: string; side: "buy" | "sell";
  qty: number; priceTzs: number; usdPerTzs: number;
  netUsdc: number; feeUsdc: number;
  payTo: `0x${string}`; payToken: `0x${string}`; payDecimals: number;
  payAmount: string; expiresAt: string;
};

type Step = "idle" | "quoting" | "paying" | "settling";

const PRESETS = [5, 20, 50, 100];
const usd = (n: number) => `$${n.toFixed(2)}`;
const qtyFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 8 });

export function SelfCustodyTicket({ symbol, side, initialAmount, currencySwitch }: {
  symbol: string;
  side: "buy" | "sell";
  /** An amount chosen in the hero ticket before this one was reached. */
  initialAmount?: string | null;
  /**
   * The TZS/USDC control, owned by the panel above.
   *
   * It sits on this ticket's own label row, so switching currency does not
   * mean looking somewhere else on the page — but the state behind it decides
   * which ticket exists, which makes it the panel's to hold.
   */
  currencySwitch?: React.ReactNode;
}) {
  const { t } = useT();
  const router = useRouter();
  const { account } = useCapimonAccount();
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();

  const [linked, setLinked] = useState<string[] | null>(null);
  const [marks, setMarks] = useState<Marks | null>(null);
  const [raw, setRaw] = useState("");

  /*
   * Taken once, and only into an untouched field.
   *
   * The handoff arrives a beat after mount, and overwriting whatever somebody
   * has started typing in the meantime would be worse than losing it.
   */
  const took = useRef(false);
  useEffect(() => {
    if (took.current || !initialAmount) return;
    /*
     * The ref is claimed inside the callback, not before scheduling it.
     *
     * Claiming it first looks equivalent and is not: StrictMode runs an
     * effect, tears it down and runs it again, so the first pass marked the
     * handoff taken, the cleanup cancelled the timeout that would have
     * applied it, and the second pass saw the mark and did nothing. The
     * amount arrived in development and vanished — the worst version, since
     * production would have been fine and nobody would have known why.
     */
    const id = window.setTimeout(() => {
      took.current = true;
      setRaw((v) => (v ? v : initialAmount));
    }, 0);
    return () => window.clearTimeout(id);
  }, [initialAmount]);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<{ qty: number; tx: string | null } | null>(null);

  /* What the connected wallet can actually spend. */
  const { data: usdcRaw } = useReadContract({
    address: USDC_BASE, abi: b20Abi, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && chainId === base.id, refetchInterval: 20_000 },
  });
  const usdcBalance = usdcRaw ? Number(formatUnits(usdcRaw as bigint, 6)) : 0;

  /* And what they hold of the share itself, for the sell side. */
  const [token, setToken] = useState<{ address: `0x${string}`; decimals: number } | null>(null);
  const { data: shareRaw } = useReadContract({
    address: token?.address, abi: b20Abi, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!token && chainId === base.id, refetchInterval: 20_000 },
  });
  // Read at the token's own precision rather than an assumed eight: a listing
  // added later with different decimals would otherwise report a balance off
  // by orders of magnitude, which is a bad way to learn about a new security.
  const shareHeld = shareRaw && token ? Number(formatUnits(shareRaw as bigint, token.decimals)) : 0;

  const loadLinks = useCallback(async () => {
    if (!account) { setLinked([]); return; }
    try {
      const j = await (await fetch("/api/self/link", { cache: "no-store" })).json();
      setLinked(j.ok ? j.wallets.map((w: { address: string }) => w.address.toLowerCase()) : []);
    } catch { setLinked([]); }
  }, [account]);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/self/order?security=${encodeURIComponent(symbol)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (alive && j.ok) setMarks(j); })
        .catch(() => { /* the button will say the price is unavailable */ });
    };
    load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [symbol]);

  /* The token's own address, so the sell side can read what is held. */
  useEffect(() => {
    let alive = true;
    fetch("/api/securities", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j.ok) return;
        const s = j.securities?.find((x: { symbol: string }) => x.symbol === symbol);
        if (s?.token_address) {
          setToken({ address: s.token_address as `0x${string}`, decimals: Number(s.decimals) || 8 });
        }
      })
      .catch(() => { /* the sell side falls back to typing a number */ });
    return () => { alive = false; };
  }, [symbol]);

  const isLinked = !!address && !!linked?.includes(address.toLowerCase());
  const wrongChain = isConnected && chainId !== base.id;
  const verified = account?.user.kycStatus === "approved";
  const n = Number(raw.replace(/,/g, "")) || 0;

  /*
   * The order as it stands, worked out the way the server will work it out.
   *
   * A preview that rounds differently from the thing it previews is worse
   * than no preview, so the arithmetic mirrors `quote()` exactly: on a buy
   * the fee comes out of what is sent, on a sell it comes off the proceeds.
   */
  const preview = (() => {
    const perShare = marks?.usdPerShare ?? 0;
    if (!(perShare > 0) || !(n > 0)) return null;
    const feeRate = (marks?.feeBps ?? 250) / 10_000;
    const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
    const floor8 = (x: number) => Math.floor(x * 1e8) / 1e8;
    if (side === "buy") {
      const fee = r6(n * feeRate);
      return { qty: floor8(r6(n - fee) / perShare), fee, total: r6(n), perShare };
    }
    const qty = floor8(n);
    const gross = r6(qty * perShare);
    const fee = r6(gross * feeRate);
    return { qty, fee, total: r6(gross - fee), perShare };
  })();

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
      const msg = e instanceof Error ? e.message : t("Could not link that wallet");
      setError(/user rejected|denied/i.test(msg) ? t("You cancelled that in your wallet.") : msg);
    }
  };

  /**
   * Quote, pay, present the receipt.
   *
   * One tap for all three: the price was on screen before it was pressed, so
   * a second confirmation step would only be asking about a number that has
   * not changed. The hash is all the client sends — which token moved, from
   * whom, to whom and how much all come out of the receipt on the server,
   * because a page that can name its own payment can name a larger one.
   */
  const trade = async () => {
    setStep("quoting"); setError(null); setSettled(null);
    let q: Quote;
    try {
      const j = await (await fetch("/api/self/order", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, security: symbol, side, amount: n }),
      })).json();
      if (!j.ok) throw new Error(j.error);
      q = j.quote;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not price that"));
      setStep("idle");
      return;
    }

    try {
      setStep("paying");
      const txHash = await writeContractAsync({
        address: q.payToken, abi: b20Abi, functionName: "transfer",
        args: [q.payTo, BigInt(q.payAmount)],
      });
      setStep("settling");
      await client?.waitForTransactionReceipt({ hash: txHash });
      const j = await (await fetch("/api/self/order", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, reference: q.reference, txHash }),
      })).json();
      if (!j.ok) throw new Error(j.error);
      haptic("success");
      setSettled({ qty: j.order.qty, tx: j.order.settleTx });
      setRaw("");
      /*
       * Tell the rest of the app the chain has moved.
       *
       * The portfolio reads balances off Base on a twenty-second poll, so
       * without this somebody who watched the transfer confirm in their
       * wallet came back to a page still saying they held nothing.
       */
      window.dispatchEvent(new CustomEvent("capx:settled", { detail: { symbol, side } }));
    } catch (e) {
      haptic("error");
      const msg = e instanceof Error ? e.message : t("That did not go through");
      setError(/user rejected|denied/i.test(msg) ? t("You cancelled that in your wallet.") : msg);
    } finally {
      setStep("idle");
    }
  };

  /* ------------------------------------------------------------- button -- */

  const busy = step !== "idle";
  const tooMany = side === "buy" && !!preview && !!marks && preview.qty > marks.available;
  const tooPoor = side === "buy" && !!preview && preview.total > usdcBalance;
  const tooFew = side === "sell" && !!preview && !!token && preview.qty > shareHeld;

  /*
   * One button, carrying whatever is in the way.
   *
   * Each of these was a paragraph that replaced the ticket, which is the
   * wrong shape for a thing you can act on — somebody who needs to verify
   * should be told on the control they just reached for, and taken there.
   */
  const gate: { label: string; onClick?: () => void } | null =
    /*
     * A connected wallet with no CAPX account behind it.
     *
     * "Sign in to continue" was a statement, and the wrong one: somebody who
     * has just connected a wallet has no account to sign in to, and what they
     * actually need is to open one and be verified. The button says that and
     * goes there — /join carries both, so a returning customer signs in from
     * the same screen.
     */
    !account ? { label: t("Verify your identity to trade"), onClick: () => router.push("/join") }
    : !verified ? {
        label: account.user.kycStatus === "pending" ? t("Verification under review") : t("Complete verification first"),
        onClick: account.user.kycStatus === "pending" ? undefined : () => router.push("/verify"),
      }
    : !isConnected ? null            // the connect button stands in for it
    : wrongChain ? { label: t("Switch your wallet to Base") }
    : linked === null ? { label: t("Loading…") }
    /*
     * A fallback, not the introduction.
     *
     * Linking is asked for where the wallet is connected — a prompt on the
     * markets and the portfolio catches it long before anybody reaches a
     * ticket. This stays because somebody can always arrive here first, and a
     * Buy button that simply refused would be worse than one that says what
     * is missing.
     */
    : !isLinked ? { label: t("Link this wallet"), onClick: () => { haptic(); void link(); } }
    : null;

  const label =
    step === "quoting" ? t("Pricing…")
    : step === "paying" ? t("Confirm in your wallet…")
    : step === "settling" ? t("Settling…")
    : `${t(side === "buy" ? "Buy" : "Sell")} ${symbol}`;

  return (
    <div className="mt-4">
      <label className="block">
        <span className="eyebrow flex items-center justify-between gap-2">
          <span>{side === "buy" ? t("Spend (USDC)") : `${t("Sell")} (${symbol})`}</span>
          {currencySwitch}
        </span>
        <input
          inputMode="decimal"
          value={raw}
          onChange={(e) => { setRaw(e.target.value.replace(/[^\d.]/g, "")); setSettled(null); }}
          placeholder={side === "buy" ? "20" : "1"}
          className="tnum mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-3 text-lg outline-none focus:border-[var(--color-accent)]"
        />
        {/* Where the shilling ticket shows a balance, so the two agree. */}
        {isConnected && !wrongChain && (
          <span className="tnum mt-1 block text-right text-[11px] text-[var(--muted)]">
            {t("In your wallet")}{" "}
            <span className="text-[var(--fg)]">
              {side === "buy" ? `${usd(usdcBalance)} USDC` : `${qtyFmt(shareHeld)} ${symbol}`}
            </span>
          </span>
        )}
      </label>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {side === "buy" ? (
          <>
            {PRESETS.map((p) => (
              <button key={p} onClick={() => setRaw(String(p))}
                className="rounded-full border hairline px-3 py-1 text-[11px] hover:surface">
                ${p}
              </button>
            ))}
            <button
              onClick={() => setRaw(String(Math.floor(usdcBalance * 100) / 100))}
              disabled={!(usdcBalance > 0)}
              className="rounded-full border hairline px-3 py-1 text-[11px] hover:surface disabled:opacity-40"
            >
              {t("All")}
            </button>
          </>
        ) : (
          [0.25, 0.5, 1].map((f) => (
            <button key={f}
              onClick={() => setRaw(String(Math.floor(shareHeld * f * 1e8) / 1e8))}
              disabled={!(shareHeld > 0)}
              className="rounded-full border hairline px-3 py-1 text-[11px] hover:surface disabled:opacity-40"
            >
              {f === 1 ? t("All") : `${f * 100}%`}
            </button>
          ))
        )}
      </div>

      {/* The same four rows the shilling ticket shows, in dollars. */}
      {preview && (
        <dl className="mt-3 grid gap-1.5 rounded-xl surface px-3.5 py-3 text-[12.5px]">
          <Row label={t("Shares")} value={`${qtyFmt(preview.qty)} ${symbol}`} />
          <Row label={t("Price")} value={`${usd(preview.perShare)} · ${marks?.priceTzs.toLocaleString()} TZS`} />
          <Row label={`${t("Fee")} (${((marks?.feeBps ?? 250) / 100).toFixed(2)}%)`} value={usd(preview.fee)} />
          <Row
            label={side === "buy" ? t("Total cost") : t("You receive")}
            value={usd(preview.total)}
            strong
          />
        </dl>
      )}

      {/* What is left to sell. What is in the wallet sits under the label. */}
      {side === "buy" && marks && (
        <div className="mt-2 text-right text-[11px] text-[var(--muted)]">
          <span className="tnum">{qtyFmt(marks.available)} {symbol} {t("available")}</span>
        </div>
      )}

      {tooMany && <Warn>{t("More than CAPX can deliver to a wallet right now.")}</Warn>}
      {tooPoor && (
        <Warn>
          {t("Your wallet holds")} {usd(usdcBalance)} USDC. {t("You need")} {usd(preview!.total - usdcBalance)} {t("more")}.
        </Warn>
      )}
      {tooFew && <Warn>{t("More than this wallet holds.")}</Warn>}

      {settled && (
        <div className="mt-3 rounded-xl border border-[var(--color-up)]/40 bg-[var(--color-up)]/[0.06] p-3 text-[12.5px]">
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

      {/*
        The connect button stands in for the trade button when there is no
        wallet yet: connecting is the action, and a disabled "Buy" above it
        would be two controls for one step.
      */}
      {account && verified && !isConnected ? (
        <div className="mt-4"><WalletButton /></div>
      ) : gate ? (
        <button
          onClick={gate.onClick}
          disabled={!gate.onClick}
          className="mt-4 w-full rounded-full bg-[var(--fg)] py-3 text-[14px] font-medium text-[var(--bg)] disabled:opacity-40"
        >
          {gate.label}
        </button>
      ) : (
        <button
          onClick={() => { haptic(); void trade(); }}
          disabled={busy || !preview || !(preview.qty > 0) || tooMany || tooPoor || tooFew}
          className="mt-4 w-full rounded-full bg-[var(--fg)] py-3 text-[14px] font-medium text-[var(--bg)] disabled:opacity-40"
        >
          {label}
        </button>
      )}

      {error && <p className="mt-3 text-[12px] leading-snug text-[var(--color-down)]">{error}</p>}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        {side === "buy"
          ? t("The shares go to your own wallet on Base. CAPX is the counterparty at the published DSE mark, converted at the nTZS rate. You pay first, then CAPX sends — you will see both in your wallet.")
          : t("Send the shares back to CAPX and USDC comes to your wallet, at the same published mark.")}
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
