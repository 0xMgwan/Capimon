"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { SW } from "./sw";

/**
 * Language, in the two most people here actually read.
 *
 * The English string is the key. That means a phrase nobody has translated yet
 * renders as English rather than as a missing-key marker, and adding a
 * translation never requires touching the component that shows it. The cost is
 * that editing English copy orphans its translation — which is the right cost,
 * because a changed sentence usually should be re-translated rather than
 * silently keeping the old one.
 */

export type Lang = "en" | "sw";
const KEY = "capx-lang";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string };
const LangCtx = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (s) => s });

export function LangProvider({ children }: { children: React.ReactNode }) {
  /*
   * Read once, lazily, so a saved choice applies on the first paint. Server and
   * first client render must agree, so detection happens in the effect below
   * rather than here — a hydration mismatch on the whole tree is a worse bug
   * than one frame of English.
   */
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    // Deferred out of the effect body: a synchronous setState during an effect
    // cascades a second render of the whole tree before the first has painted.
    const id = setTimeout(() => {
      let next: Lang | null = null;
      try {
        const saved = localStorage.getItem(KEY);
        if (saved === "sw" || saved === "en") next = saved;
      } catch { /* fall through to detection */ }
      // No choice made yet: follow the browser. A phone set to Swahili belongs
      // to someone who would rather read Swahili.
      if (!next && typeof navigator !== "undefined"
          && navigator.language?.toLowerCase().startsWith("sw")) {
        next = "sw";
      }
      if (next && next !== "en") setLangState(next);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* session only */ }
    if (typeof document !== "undefined") document.documentElement.lang = l;
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback((s: string) => (lang === "sw" ? SW[s] ?? s : s), [lang]);

  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>;
}

export function useT() {
  return useContext(LangCtx);
}
