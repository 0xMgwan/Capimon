"use client";

import { useEffect, useState } from "react";
import { PriceChart } from "./PriceChart";
import type { Candle } from "@/lib/markets";
import { useT } from "@/lib/i18n";

/**
 * A DSE security's price history, one point per session the exchange printed.
 *
 * No "1D" range: DSE prints once a day, so an intraday view would either be a
 * single point or a line through prices that were never quoted. The ranges
 * offered are the ones the data can actually fill.
 */
const TZS_RANGES = ["1W", "1M", "ALL"] as const;

const fmt = (n: number) =>
  `${Math.round(n).toLocaleString("en-TZ")} TZS`;

export function CrdbChart({ symbol = "CRDB" }: { symbol?: string }) {
  const { t } = useT();
  const [candles, setCandles] = useState<Candle[] | null>(null);
  /** Set when the series is the saved copy, because the exchange is down. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [source, setSource] = useState<string>("dse");

  useEffect(() => {
    let alive = true;
    fetch(`/api/securities/${encodeURIComponent(symbol.toLowerCase())}/history`)
      .then((r) => r.json())
      .then((d) => { if (alive && d.ok) { setCandles(d.candles ?? []); setCachedAt(d.cachedAt ?? null); setSource(d.source ?? "dse"); } })
      .catch(() => { if (alive) setCandles([]); });
    return () => { alive = false; };
  }, [symbol]);

  if (candles === null) {
    return <div className="h-[240px] animate-pulse rounded-3xl surface sm:h-[320px]" />;
  }
  // A listing CAPX added recently has one published price so far: say so,
  // rather than calling a new security's history "unavailable".
  if (candles.length === 1 && source === "oracle") {
    return (
      <div className="rounded-2xl border hairline p-4 text-[13px] text-[var(--muted)] sm:rounded-3xl sm:p-6">
        {t("First price published by CAPX on")}{" "}
        {new Date(candles[0].t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}:{" "}
        <span className="tnum font-medium text-[var(--fg)]">{candles[0].p.toLocaleString("en-TZ")} TZS</span>.{" "}
        {t("The chart fills in day by day, and shows the full DSE history once the exchange is back.")}
      </div>
    );
  }
  if (candles.length < 2) {
    return (
      <div className="rounded-3xl border hairline p-6 text-sm text-[var(--muted)]">
        {t("The DSE's price history is unavailable right now. The chart returns as soon as the exchange is back.")}
      </div>
    );
  }

  return (
    <PriceChart
      data={candles}
      color="#0B7D3E"
      format={fmt}
      ranges={TZS_RANGES}
      provenance={(n) =>
        source === "oracle"
          ? `${n} days of prices published by CAPX · shown while DSE data is unavailable`
          : cachedAt
            ? `${n} daily prices · DSE history saved ${new Date(cachedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}${source === "saved+oracle" ? ", then CAPX's published prices" : ""}`
            : `${n} daily closes on the Dar es Salaam Stock Exchange`
      }
    />
  );
}
