"use client";

import Link from "next/link";
import { TradeFeed } from "./TradeFeed";
import { useT } from "@/lib/i18n";

/**
 * A sign that somebody else is here.
 *
 * A portfolio is a closed loop — your money, your shares, your return — and a
 * market showing no trace of anyone else in it reads as an empty building.
 * One line of what just traded is enough to say otherwise.
 *
 * It sits at the foot of the page on purpose. Near the top it competed with
 * the balance, which is what the page is for; down here it is the thing you
 * arrive at once you have finished reading your own numbers, which is exactly
 * when other people become interesting. The ranking is not repeated here —
 * it has its own page, reachable from the menu, and a top three above the
 * fold turned somebody checking their balance into somebody being compared.
 */
export function MarketRoom() {
  const { t } = useT();

  return (
    <section className="mt-3 rounded-3xl border hairline p-4 sm:p-5">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="eyebrow">{t("Happening now")}</span>
        <Link
          href="/leaderboard"
          className="text-[11px] text-[var(--muted)] underline underline-offset-2 transition-colors hover:text-[var(--fg)]"
        >
          {t("Top traders")}
        </Link>
      </div>
      <TradeFeed />
    </section>
  );
}
