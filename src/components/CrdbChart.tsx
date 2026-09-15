"use client";

import { useEffect, useState } from "react";
import { PriceChart } from "./PriceChart";
import type { Candle } from "@/lib/markets";
import { useT } from "@/lib/i18n";

/**
 * CRDB's price history, one point per session the exchange printed.
 *
 * No "1D" range: DSE prints once a day, so an intraday view would either be a
 * single point or a line through prices that were never quoted. The ranges
 * offered are the ones the data can actually fill.
 */
const TZS_RANGES = ["1W", "1M", "ALL"] as const;

const fmt = (n: number) =>
  `${Math.round(n).toLocaleString("en-TZ")} TZS`;

export function CrdbChart() {
  const { t } = useT();
  const [candles, setCandles] = useState<Candle[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/securities/crdb/history")
      .then((r) => r.json())
      .then((d) => { if (alive && d.ok) setCandles(d.candles ?? []); })
      .catch(() => { if (alive) setCandles([]); });
    return () => { alive = false; };
  }, []);

  if (candles === null) {
    return <div className="h-[240px] animate-pulse rounded-3xl surface sm:h-[320px]" />;
  }
  if (candles.length < 2) {
    return (
      <div className="rounded-3xl border hairline p-6 text-sm text-[var(--muted)]">
        {t("No price history available from the exchange right now.")}
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
        `${n} exchange closes · Dar es Salaam Stock Exchange · one print a session, no weekend trading`
      }
    />
  );
}
