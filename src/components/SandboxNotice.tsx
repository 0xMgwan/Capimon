"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * What a visitor is told before they start, and the record that they were.
 *
 * CAPX and nTZS both operate under regulatory sandbox authorisations, which
 * is a materially different thing from a full licence: it is supervised,
 * time-boxed and capped. Somebody deciding whether to put money in is
 * entitled to know that before they decide, not in a paragraph under the
 * fold, and we are better off saying it plainly than being asked later why
 * we did not.
 *
 * So it asks for an explicit acceptance rather than offering a dismiss. A
 * notice with an X in the corner collects nothing; the tick and the button
 * are the point, and they are the only way past it.
 *
 * ## Why the version is in the key
 *
 * Acceptance is of a particular text. When the authorisation changes — a
 * different phase, different limits, a licence — the sentences change and
 * the old acceptance no longer covers them. Bumping the version shows it
 * again to everybody, which is the behaviour you want and is impossible if
 * the key is just "seen".
 */
const VERSION = "2026-10-sandbox-v1";
const KEY = `capx.sandbox.${VERSION}`;

export function SandboxNotice() {
  const { t } = useT();
  /*
   * Starts hidden and is shown only after the browser has been asked.
   * Rendering first and hiding on mount is what makes a notice flash on every
   * page load for somebody who accepted it months ago.
   */
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      /* Private browsing, blocked storage: show it. Being told twice is a
         smaller fault than never being told. */
      setOpen(true);
    }
  }, []);

  /* While it is up, the page behind it does not scroll. */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const accept = async () => {
    setBusy(true);
    try { localStorage.setItem(KEY, new Date().toISOString()); } catch { /* fine */ }
    /* Recorded against the account when there is one. The notice closes
       either way — a failed write is ours to chase, not theirs to retry. */
    await fetch("/api/account/consent", { method: "POST" }).catch(() => {});
    setOpen(false);
    setBusy(false);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sandbox-title"
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
    >
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border hairline bg-[var(--bg)] p-6 shadow-2xl sm:rounded-3xl sm:p-7">
        <div className="eyebrow">{t("Before you start")}</div>
        <h2 id="sandbox-title" className="display mt-2 text-2xl leading-tight">
          {t("CAPX operates in a regulatory sandbox.")}
        </h2>

        <div className="mt-4 space-y-3 text-[13.5px] leading-relaxed text-[var(--muted)]">
          <p>
            {t("Tokenised Dar es Salaam Stock Exchange assets are offered by CAPX under a regulatory sandbox arrangement in Tanzania. A sandbox is supervised, time-limited testing — not a full licence — and it can carry caps on how many people take part and how much they transact.")}
          </p>
          <p>
            {t("nTZS, the Tanzanian shilling stablecoin CAPX settles in, operates in the Bank of Tanzania regulatory sandbox under its own authorisation and its own limits.")}
          </p>
          <p>
            {t("What you hold is a representation of the underlying share, held by a custodian or a special purpose vehicle, rather than registered shareholding. Tanzanian shares carry no dividend entitlement and no voting rights. Prices can fall as well as rise, and you can get back less than you put in.")}
          </p>
          <p>
            {t("US shares are issued by a third party and are not available to US persons. CAPX is not an exchange or an investment adviser, and nothing here is investment advice.")}
          </p>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border hairline p-3.5">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--fg)]"
          />
          <span className="text-[13px] leading-relaxed">
            {t("I have read, understood and accept the above, including that CAPX and nTZS operate under regulatory sandbox authorisations.")}
          </span>
        </label>

        <button
          onClick={() => void accept()}
          disabled={!agreed || busy}
          className="mt-4 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] transition-opacity disabled:opacity-40"
        >
          {busy ? t("Saving…") : t("Accept and continue")}
        </button>

        <p className="mt-3 text-center text-[11.5px] text-[var(--muted)]">
          <a href="/terms" className="underline underline-offset-2">{t("Terms of service")}</a>
          {" · "}
          <a href="/privacy" className="underline underline-offset-2">{t("Privacy policy")}</a>
        </p>
      </div>
    </div>
  );
}
