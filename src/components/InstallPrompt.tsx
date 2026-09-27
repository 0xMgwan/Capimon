"use client";

import { useEffect, useState } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

/**
 * Asking somebody to put CAPX on their home screen.
 *
 * Installed, this stops being a website: it opens on the portfolio, keeps a
 * session for a month, receives the morning and evening notes, and — the part
 * nobody can be told, only felt — the buttons tap back. None of that is
 * reachable from a Safari tab, so the gap between the two experiences is
 * wider than it looks, and the only thing standing in it is a gesture most
 * people do not know their phone has.
 *
 * Shown to somebody signed in, because a stranger has not yet decided they
 * want this and an install prompt before an account is a shop asking for
 * shelf space. Shown once, dismissible, and quiet for a month afterwards: a
 * banner somebody has already said no to is an advertisement.
 *
 * Two platforms, two different truths. Android hands the browser a real
 * install event, so it gets a button that installs. iOS has no such API and
 * never has — the only route is Share, then Add to Home Screen — so it gets
 * the actual steps with the actual icon, rather than a button that would have
 * to explain why it does not work.
 */
const DISMISSED_KEY = "capx-install-dismissed";
const QUIET_DAYS = 30;

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function isStandalone() {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(display-mode: standalone)").matches
    // iOS reports it here and nowhere else.
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    || (ua.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1);
}

export function InstallPrompt() {
  const { t } = useT();
  const { account } = useCapimonAccount();
  const [show, setShow] = useState(false);
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [steps, setSteps] = useState(false);

  /* Android offers the install itself; catching it is what makes a button possible. */
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    if (!account) return;
    if (isStandalone()) return;
    // A phone, not a laptop: the home screen is the thing being offered.
    if (!("ontouchstart" in window) && (navigator.maxTouchPoints ?? 0) === 0) return;

    let quiet = false;
    try {
      const until = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
      quiet = Date.now() < until;
    } catch { /* a blocked store means it simply asks */ }
    if (quiet) return;

    /*
     * A beat after arriving, not during it. Signing in already has a modal
     * closing and a page changing under it; a third thing appearing in that
     * moment reads as a pop-up rather than as an offer.
     */
    const id = window.setTimeout(() => setShow(true), 2500);
    return () => window.clearTimeout(id);
  }, [account]);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now() + QUIET_DAYS * 864e5));
    } catch { /* it will ask again next session, which is the milder failure */ }
  };

  const install = async () => {
    if (!deferred) { setSteps(true); return; }
    haptic("medium");
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" }));
    setDeferred(null);
    // Accepted or not, it has been asked and answered.
    if (choice.outcome === "accepted") setShow(false);
    else dismiss();
  };

  if (!show) return null;

  const ios = isIos();

  return (
    <div className="fixed inset-x-3 bottom-[5.25rem] z-[55] mx-auto max-w-sm rounded-2xl border hairline bg-[var(--bg)] p-3.5 shadow-2xl shadow-black/15 md:bottom-4">
      <div className="flex items-start gap-3">
        {/* The icon it will have once it is there. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/app-icon?size=192" alt="" width={38} height={38}
          className="mt-0.5 shrink-0 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">{t("Put CAPX on your home screen")}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
            {t("Opens straight to your portfolio, stays signed in, and sends your morning and evening notes.")}
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label={t("Not now")}
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-[var(--muted)] hover:surface"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/*
        * iOS gets the steps, because iOS has no install API.
        * A button that opened nothing would be worse than the two taps it
        * would be pretending to save.
        */}
      {ios || steps ? (
        <ol className="mt-3 grid gap-1.5 rounded-xl surface px-3 py-2.5 text-[12px] text-[var(--muted)]">
          <li className="flex items-center gap-2">
            <span className="tnum shrink-0 text-[var(--fg)]">1</span>
            {t("Tap")}
            <ShareIcon />
            {t("in the toolbar")}
          </li>
          <li className="flex items-center gap-2">
            <span className="tnum shrink-0 text-[var(--fg)]">2</span>
            {t("Choose")} <span className="text-[var(--fg)]">{t("Add to Home Screen")}</span>
          </li>
        </ol>
      ) : (
        <button
          onClick={() => void install()}
          className="mt-3 w-full rounded-full bg-[var(--fg)] py-2.5 text-[13px] font-medium text-[var(--bg)] active:scale-95"
        >
          {t("Add to home screen")}
        </button>
      )}
    </div>
  );
}

/** Apple's share mark, so the instruction points at something recognisable. */
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[var(--color-accent)]"
      fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V3" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M6 12H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}
