"use client";

import { useT } from "@/lib/i18n";

/**
 * Shared shell for the legal pages.
 *
 * A client component so the headings can be translated; the sections
 * themselves stay in English for now, because a translated contract that says
 * something slightly different from the English one is worse than one language
 * done properly. That is flagged on the page rather than left for someone to
 * discover.
 */
export type Section = { h: string; p: string[] };

export function LegalPage({
  eyebrow, title, updated, intro, sections,
}: {
  eyebrow: string; title: string; updated: string; intro: string; sections: Section[];
}) {
  const { t } = useT();
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-24 pt-8 sm:px-8 sm:pt-10">
      <div className="eyebrow">{t(eyebrow)}</div>
      <h1 className="display mt-1.5 text-[clamp(1.6rem,3.6vw,2.3rem)]">{title}</h1>
      <p className="mt-2 text-[12px] text-[var(--muted)]">{updated}</p>
      <p className="mt-5 text-[15px] leading-relaxed text-[var(--muted)]">{intro}</p>

      <div className="mt-8 space-y-7">
        {sections.map((s, i) => (
          <section key={s.h}>
            <h2 className="flex gap-3 text-[15px] font-semibold">
              <span className="tnum shrink-0 text-[var(--muted)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              {s.h}
            </h2>
            <div className="mt-2 space-y-2.5 pl-9">
              {s.p.map((para) => (
                <p key={para.slice(0, 40)} className="text-[14px] leading-relaxed text-[var(--muted)]">
                  {para}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/*
        * Said plainly rather than buried.
        *
        * These were written to describe honestly what the platform does. They
        * have not been reviewed by a Tanzanian lawyer, and a customer reading a
        * contract deserves to know which of those two things is true.
        */}
      <p className="mt-10 rounded-2xl border border-dashed hairline p-4 text-[12px] leading-relaxed text-[var(--muted)]">
        {t("These terms describe how CAPX actually operates today. They have not yet been reviewed by a licensed Tanzanian advocate, and will be updated when they are. If anything here conflicts with Tanzanian law, the law applies.")}
      </p>
    </main>
  );
}
