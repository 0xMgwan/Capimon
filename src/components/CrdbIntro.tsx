"use client";

import { useT } from "@/lib/i18n";

/** The page heading, in a client component so it can read the language. */
export function CrdbIntro() {
  const { t } = useT();
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{t("CRDB Bank Plc")}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
        {t("Tanzania’s largest bank by assets, listed on the Dar es Salaam Stock Exchange. One CRDBt is one share, held in custody and settled in shillings.")}
      </p>
    </div>
  );
}
