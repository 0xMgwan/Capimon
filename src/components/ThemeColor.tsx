"use client";

import { useEffect } from "react";

const LIGHT = "#fcfcfb";
const DARK = "#0b0c0b";

/**
 * Keeps the browser and home-screen app bar the colour of the page.
 *
 * The bar used to follow the phone's system setting, but CAPX's theme is its
 * own switch, not the system one — so a phone in dark mode drew a black bar
 * over a light page, and choosing dark here left a white bar over a dark one.
 * It now reads the class the theme switch sets, and follows every change.
 */
export function ThemeColor() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const color = root.classList.contains("dark") ? DARK : LIGHT;
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
      // Media-qualified tags would win on some browsers; one plain tag is the source.
      document.querySelectorAll('meta[name="theme-color"][media]').forEach((m) => m.remove());
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
      }
      meta.content = color;
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return null;
}
