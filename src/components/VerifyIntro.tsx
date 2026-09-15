"use client";

import { useT } from "@/lib/i18n";

/** The page heading, in a client component so it can read the language. */
export function VerifyIntro() {
  const { t } = useT();
  return (
    <>
      <div className="eyebrow">{t("Verification")}</div>
      <h1 className="display mt-1.5 text-[clamp(1.5rem,3.4vw,2.1rem)]">{t("Confirm it’s you.")}</h1>
      <p className="mt-2.5 max-w-md text-sm leading-relaxed text-[var(--muted)]">
        {t("Two photographs: the document you hold, and you holding the phone. It takes about a minute and only has to be done once.")}
      </p>
    </>
  );
}
