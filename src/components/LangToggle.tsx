"use client";

import { useT } from "@/lib/i18n";

/**
 * Switches between English and Swahili from the nav.
 *
 * Shows the code it will switch *to*, not the one in use. A control that
 * displays the current state reads as a label and gets ignored; one that
 * displays the outcome reads as a button. Two languages need no menu, so this
 * is a toggle rather than a picker.
 */
export function LangToggle() {
  const { lang, setLang } = useT();
  const next = lang === "en" ? "sw" : "en";

  return (
    <button
      onClick={() => setLang(next)}
      aria-label={next === "sw" ? "Badilisha lugha kuwa Kiswahili" : "Switch language to English"}
      title={next === "sw" ? "Kiswahili" : "English"}
      className="grid h-9 w-9 place-items-center rounded-full border hairline text-[11px] font-semibold tracking-wide transition-colors hover:surface"
    >
      {next.toUpperCase()}
    </button>
  );
}
