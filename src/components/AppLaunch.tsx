"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * Opens the home-screen app on Markets.
 *
 * The manifest's start_url says so, but iOS often launches a home-screen app
 * at the page it was added from instead, which is usually the landing page —
 * the pitch to a visitor, not the screen someone who installed the app came
 * for. When the app is running standalone and its first page is "/", it moves
 * on to Markets. Only once per launch, so the Home tab still goes home.
 */
export function AppLaunch() {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    try {
      const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!standalone || sessionStorage.getItem("capx-launched")) return;
      sessionStorage.setItem("capx-launched", "1");
      if (path === "/") router.replace("/markets");
    } catch { /* storage blocked: stay where we are */ }
    // Launch only: later navigation must not trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
