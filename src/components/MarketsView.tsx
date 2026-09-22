"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useDse, matchesDse } from "@/lib/useDse";
import { DseLogo } from "./DseLogo";
import { KycPrompt } from "./KycPrompt";
import { useMarkets } from "@/lib/useMarkets";
import { MarketTable } from "./MarketTable";
import { AssetLogo } from "./AssetLogo";
import { useT } from "@/lib/i18n";

export function MarketsView() {
  const { t } = useT();
  const { data, error } = useMarkets();
  /** Shared with the table below, so one search filters both lists. */
  const [query, setQuery] = useState("");
  // Every tokenised DSE share, filtered by the same search as the table, so a
  // listing that ignores the filter never reads as a bug.
  const dseShown = useDse().filter((d) => matchesDse(d, query));
  const markets = useMemo(() => data?.markets ?? [], [data]);


  /*
   * Compact, app-first.
   *
   * The page spent its first 1,300px on a phone on a title, a paragraph about
   * oracles, three onchain statistics and three large cards before the first
   * company appeared. It now opens on the search and a market filter, with
   * the DSE listings and the US list directly under them, and the movers as a
   * single swipeable strip.
   */
  const [scope, setScope] = useState<"all" | "tz" | "us">("all");
  const movers = useMemo(
    () => [...markets].sort((x, y) => Math.abs(y.change) - Math.abs(x.change)).slice(0, 8),
    [markets],
  );

  const filter = (
    <div className="flex rounded-full surface p-0.5 text-[12.5px]">
      {([["all", t("All")], ["tz", t("Tanzania")], ["us", t("US")]] as const).map(([k, l]) => (
        <button key={k} onClick={() => setScope(k)}
          className={`rounded-full px-3.5 py-1.5 font-medium transition-colors ${
            scope === k ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"}`}>
          {l}
        </button>
      ))}
    </div>
  );

  const dseBlock = scope !== "us" && dseShown.length > 0 && (
    <div className="mb-4">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="eyebrow">{t("Dar es Salaam")} · {t("in shillings")}</span>
      </div>
      <div className="grid gap-1.5 md:grid-cols-2 lg:grid-cols-3">
        {dseShown.map((d) => (
          <Link key={d.symbol} href={`/markets/${d.symbol.toLowerCase()}`}
            className="flex items-center gap-3 rounded-2xl border hairline px-3 py-2.5 transition-colors hover:surface active:surface">
            <DseLogo logo={d.logo} symbol={d.symbol} size={34} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-[15px] font-semibold tracking-tight">{d.symbol}</span>
                {d.status === "suspended" && <span className="text-[10px] text-[var(--color-down)]">{t("suspended")}</span>}
              </span>
              <span className="block truncate text-[11px] leading-tight text-[var(--muted)]">{d.name}</span>
            </span>
            <DseTag price={d.price} changePct={d.changePct} last={d.source === "oracle"} />
          </Link>
        ))}
      </div>
      {scope === "all" && <div className="eyebrow mb-1.5 mt-4">{t("United States")} · {t("in dollars")}</div>}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-12 pt-3 sm:px-8 sm:pb-20 sm:pt-10">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="display text-[clamp(1.5rem,5vw,3rem)]">{t("Markets")}</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {t("Tanzanian shares in shillings, US shares in dollars.")}
          </p>
        </div>
      </div>

      <div className="mt-3"><KycPrompt /></div>

      {error && (
        <div className="mt-3 rounded-xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/5 px-4 py-3 text-sm text-[var(--color-down)]">
          {error}
        </div>
      )}

      {/* Movers, as one swipeable strip rather than three large cards. */}
      {scope !== "tz" && movers.length > 0 && (
        <div className="scroll-thin -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <span className="eyebrow shrink-0 self-center pr-1">{t("Movers")}</span>
          {movers.map((m) => (
            <Link key={m.symbol} href={`/markets/${m.ticker.toLowerCase()}`}
              className="flex shrink-0 items-center gap-1.5 rounded-full border hairline py-1 pl-1 pr-3 text-[12px] transition-colors hover:surface">
              <AssetLogo logo={m.logo} ticker={m.ticker} color={m.color} size={20} />
              <span className="font-medium">{m.ticker}</span>
              <span className={`tnum ${m.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {m.change >= 0 ? "+" : ""}{m.change.toFixed(1)}%
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-3">
        <MarketTable onQuery={setQuery} toolbar={filter} between={dseBlock} hideRows={scope === "tz"} />
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-[var(--muted)]">
        {t("Prices update live. US shares are not available to US persons.")}
      </p>
    </div>
  );
}



/** The live DSE mark, so the card is not just a link to find out. */
function DseTag({ price, changePct, last = false }: { price: number; changePct: number; last?: boolean }) {
  if (!(price > 0)) return <div className="h-8 w-20 shrink-0 animate-pulse rounded surface" />;
  const d = { price, changePct };
  const up = d.changePct >= 0;
  return (
    <div className="shrink-0 text-right">
      <div className="tnum text-base font-medium">
        {d.price.toLocaleString("en-TZ", { maximumFractionDigits: 0 })}
        <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">TZS</span>
      </div>
      {last ? (
        // The exchange is down; this is the last published price, not a flat day.
        <div className="text-[11px] text-[#b45309]">last price</div>
      ) : (
        <div className={`tnum text-[11px] ${up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
          {up ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}%
        </div>
      )}
    </div>
  );
}
