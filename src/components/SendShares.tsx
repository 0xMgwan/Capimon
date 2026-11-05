"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useCapimonAccount } from "@/lib/useCapimonAccount";

/**
 * Sending shares to somebody else on CAPX.
 *
 * Offered only to people who hold something, because a send form on an empty
 * portfolio is an invitation to an error message.
 *
 * The confirm step is deliberate. A transfer is the one thing here that
 * cannot be undone by doing the opposite — a wrong buy can be sold back, a
 * wrong send needs the recipient's goodwill — so it names who is receiving
 * before it happens rather than afterwards in a toast.
 */

type Position = { symbol: string; ticker: string; qty: number };

export function SendShares({ positions }: { positions: Position[] }) {
  const { t } = useT();
  const { refresh } = useCapimonAccount();

  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ qty: number; ticker: string; to: string } | null>(null);

  const holdings = positions.filter((p) => p.qty > 0);
  if (!holdings.length) return null;

  const chosen = holdings.find((p) => p.symbol === symbol) ?? holdings[0];
  const amount = Number(qty);
  const tooMuch = Number.isFinite(amount) && amount > chosen.qty;
  const ready = !!to.trim() && Number.isFinite(amount) && amount > 0 && !tooMuch;

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/account/transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: to.trim(), security: chosen.symbol, qty: amount, note }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? t("That transfer did not go through."));
      setDone({ qty: j.qty, ticker: chosen.ticker, to: j.to?.username ? `@${j.to.username}` : j.to?.email ?? to });
      setTo(""); setQty(""); setNote("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("Could not reach the server."));
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-2xl border hairline px-3.5 py-2.5 text-left text-[13px] transition-colors hover:surface"
      >
        {t("Send shares to someone")}
        <span className="ml-1 text-[var(--muted)]">
          {t("— to another CAPX account, free")}
        </span>
      </button>
    );
  }

  return (
    <section className="mt-3 rounded-2xl border hairline p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow">{t("Send shares")}</div>
        <button onClick={() => { setOpen(false); setDone(null); setErr(null); }}
                className="text-xs text-[var(--muted)] hover:text-[var(--fg)]">
          {t("Close")}
        </button>
      </div>

      {done ? (
        <div className="mt-3">
          <p className="text-sm">
            {t("Sent")} <b>{done.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })} {done.ticker}</b>{" "}
            {t("to")} {done.to}.
          </p>
          <button onClick={() => setDone(null)}
                  className="mt-3 rounded-full border hairline px-4 py-1.5 text-xs">
            {t("Send more")}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {holdings.map((p) => (
              <button
                key={p.symbol}
                onClick={() => { setSymbol(p.symbol); setQty(""); }}
                className={`rounded-full border hairline px-3 py-1 text-xs transition-colors ${
                  chosen.symbol === p.symbol ? "bg-[var(--fg)] text-[var(--bg)]" : "hover:surface"}`}
              >
                {p.ticker}
              </button>
            ))}
          </div>

          <label className="mt-3 block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
              {t("To")}
            </span>
            <input
              value={to} onChange={(e) => setTo(e.target.value)}
              placeholder={t("Their email or @handle")}
              className="mt-1 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label className="mt-3 block">
            <span className="flex items-baseline justify-between text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <span>{t("Shares")}</span>
              <button
                onClick={() => setQty(String(chosen.qty))}
                className="tnum normal-case tracking-normal underline underline-offset-2"
              >
                {t("All")} {chosen.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })}
              </button>
            </span>
            <input
              value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal" placeholder="0"
              className="tnum mt-1 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            {tooMuch && (
              <span className="mt-1 block text-[11px] text-[var(--color-down)]">
                {t("You hold")} {chosen.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })}.
              </span>
            )}
          </label>

          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t("Note, optional")}
            maxLength={280}
            className="mt-3 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />

          <button
            onClick={() => void send()} disabled={busy || !ready}
            className="mt-3 w-full rounded-full bg-[var(--fg)] py-2.5 text-sm font-medium text-[var(--bg)] disabled:opacity-40"
          >
            {busy ? t("Sending…") : t("Send")}
          </button>

          <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
            {t("They need a verified CAPX account. Shares arrive at the price you paid, so you book no gain and they continue from your cost. This cannot be undone — only they can send them back.")}
          </p>
          {err && <p className="mt-2 text-xs text-[var(--color-down)]">{err}</p>}
        </>
      )}
    </section>
  );
}
