"use client";

import { useT } from "@/lib/i18n";

/**
 * The page heading, in a client component so it can read the language.
 *
 * CRDB keeps its own line; any other listing gets the same sentence with its
 * name in it, so a new security has a proper page without writing copy first.
 */
export function CrdbIntro({ symbol = "CRDB", name = "CRDB Bank Plc" }: { symbol?: string; name?: string }) {
  const { t } = useT();
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{symbol === "CRDB" ? t("CRDB Bank Plc") : name}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
        {symbol === "CRDB"
          ? t("Tanzania’s largest bank by assets, listed on the Dar es Salaam Stock Exchange. One CRDBt is one share, held in custody and settled in shillings.")
          : t("Listed on the Dar es Salaam Stock Exchange. One {sym}t is one share, held in custody and settled in shillings.").replace("{sym}", symbol)}
      </p>
    </div>
  );
}
