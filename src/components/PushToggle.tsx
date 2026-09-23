"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

/**
 * Turning on notifications that arrive when the app is closed.
 *
 * Three things have to be true and any of them can be false, so the control
 * says which: the browser has to support push, the customer has to grant
 * permission, and on an iPhone the site has to have been added to the Home
 * Screen first. Safari refuses to subscribe otherwise, with an error that
 * means nothing to the person reading it, so that case is explained rather
 * than reported.
 *
 * Permission is only ever requested from a real tap. A page that asks on load
 * gets denied by people who have not yet decided they want it, and a denial
 * is not easy to take back.
 */
type State = "unknown" | "unsupported" | "needs-install" | "off" | "on" | "blocked";

/** The key is public by design: it is what the browser encrypts to. */
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** Base64url to the Uint8Array the subscribe call wants. */
function keyBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const isIos = () =>
  typeof navigator !== "undefined"
  && (/iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const isInstalled = () =>
  typeof window !== "undefined"
  && (window.matchMedia?.("(display-mode: standalone)").matches
      || (window.navigator as { standalone?: boolean }).standalone === true);

export function PushToggle() {
  const { t } = useT();
  const [state, setState] = useState<State>("unknown");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!VAPID) return;
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        // On iOS the API only exists once installed, so the honest answer is
        // "add it to your Home Screen", not "your browser cannot do this".
        if (alive) setState(isIos() && !isInstalled() ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") { if (alive) setState("blocked"); return; }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (alive) setState(sub ? "on" : "off");
    })().catch(() => { if (alive) setState("unsupported"); });
    return () => { alive = false; };
  }, []);

  const enable = async () => {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }

      const sub = await reg.pushManager.subscribe({
        // Required by every browser: a push that shows nothing is not allowed.
        userVisibleOnly: true,
        applicationServerKey: keyBytes(VAPID) as BufferSource,
      });

      const r = await fetch("/api/account/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? t("Could not turn on notifications"));
      setState("on");
      setMsg(t("Notifications are on for this device."));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("Could not turn on notifications"));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/account/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "unsubscribe", endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
      setMsg(t("Notifications are off for this device."));
    } catch {
      setMsg(t("Could not turn off notifications"));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/account/push", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const j = await r.json();
      setMsg(j.sent > 0 ? t("Sent. It should appear in a moment.") : t("Nothing was sent to this account."));
    } catch {
      setMsg(t("Could not send a test"));
    } finally {
      setBusy(false);
    }
  };

  if (!VAPID || state === "unknown" || state === "unsupported") return null;

  return (
    <div className="rounded-2xl border hairline p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-medium">{t("Notifications")}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
            {state === "needs-install"
              ? t("Add CAPX to your Home Screen first, then turn these on from there.")
              : state === "blocked"
                ? t("Your browser is blocking notifications for CAPX. Allow them in its settings to turn these on.")
                : t("Deposits, fills, and your portfolio morning and evening.")}
          </p>
        </div>
        {state === "off" && (
          <button onClick={() => { haptic(); void enable(); }} disabled={busy}
            className="shrink-0 rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40">
            {busy ? t("Turning on…") : t("Turn on")}
          </button>
        )}
        {state === "on" && (
          <span className="flex shrink-0 gap-2">
            <button onClick={() => { haptic(); void test(); }} disabled={busy}
              className="rounded-full border hairline px-3.5 py-2 text-[12px] hover:surface disabled:opacity-40">
              {t("Send a test")}
            </button>
            <button onClick={() => { haptic(); void disable(); }} disabled={busy}
              className="rounded-full border hairline px-3.5 py-2 text-[12px] text-[var(--muted)] hover:surface disabled:opacity-40">
              {t("Turn off")}
            </button>
          </span>
        )}
      </div>
      {msg && <p className="mt-2 text-[12px] text-[var(--muted)]">{msg}</p>}
    </div>
  );
}
