"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";
import { useDse } from "@/lib/useDse";
import { DseLogo } from "./DseLogo";

/**
 * A DSE security's page header: logo, name, price and today's move in one row,
 * like the US asset pages, with the description held to two lines.
 *
 * CRDB keeps its own line; any other listing gets the same sentence with its
 * name in it, so a new security has a proper page without writing copy first.
 */
export function CrdbIntro({ symbol = "CRDB", name = "CRDB Bank Plc" }: { symbol?: string; name?: string }) {
  const { t } = useT();
  const d = useDse().find((x) => x.symbol === symbol);
  const up = (d?.changePct ?? 0) >= 0;
  /* The exchange's feed is down and the price is the oracle's last one. */
  const fallback = d?.source === "oracle";
  // Just the time when it is from today, the date otherwise — short enough
  // to sit under the price without squeezing the company name.
  const when = (() => {
    if (!d?.asOf) return null;
    const at = new Date(d.asOf);
    return at.toDateString() === new Date().toDateString()
      ? at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  })();
  return (
    <div className="mb-3">
      <Link href="/markets" className="text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
        ← {t("Markets")}
      </Link>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <DseLogo logo={d?.logo ?? (symbol === "CRDB" ? "/crdb.jpg" : null)} symbol={symbol} size={44} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.045em] sm:text-4xl">{symbol}</h1>
              <span className="rounded-full surface px-2 py-0.5 text-[10px] text-[var(--muted)]">DSE</span>
            </div>
            <p className="truncate text-[12.5px] text-[var(--muted)] sm:text-sm">
              {symbol === "CRDB" ? t("CRDB Bank Plc") : (d?.name ?? name)}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum text-[1.6rem] font-medium leading-none tracking-tight sm:text-4xl">
            {d && d.price > 0 ? d.price.toLocaleString("en-TZ", { maximumFractionDigits: 0 }) : "—"}
            <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">TZS</span>
          </div>
          {d && d.price > 0 && (fallback ? (
            <div className="tnum mt-1 text-[12px] text-[#b45309]">{t("Last price")}{when ? ` · ${when}` : ""}</div>
          ) : (
            <div className={`tnum mt-1 text-[12px] ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
              {up ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}% {t("today")}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 line-clamp-2 max-w-xl text-[13.5px] leading-snug text-[var(--muted)] sm:text-sm">
        {symbol === "CRDB"
          ? t("Tanzania’s largest bank by assets, listed on the Dar es Salaam Stock Exchange. One CRDBt is one share, held in custody and settled in shillings.")
          : t("Listed on the Dar es Salaam Stock Exchange. One {sym}t is one share, held in custody and settled in shillings.").replace("{sym}", symbol)}
      </p>
      {/*
        * Said plainly when the exchange is down.
        *
        * Without this the page read "0.00% today", which looks like a live
        * price that simply has not moved. The price is real — it is the one
        * trades settle at — but it is the last one published, not today's.
        */}
      {fallback && (
        <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-[#b45309]/35 bg-[#b45309]/[0.06] px-3 py-2 text-[12px] leading-snug">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#b45309]" />
          <span className="text-[var(--muted)]">
            <span className="font-medium text-[var(--fg)]">{t("DSE data is temporarily unavailable.")}</span>{" "}
            {t("This is the last price CAPX published")}{when ? ` (${when})` : ""}{". "}
            {t("Buying and selling continue at this price.")}
          </span>
        </div>
      )}
    </div>
  );
}
