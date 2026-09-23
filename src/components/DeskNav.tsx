"use client";

import { useEffect, useState } from "react";

/**
 * The broker portal's sidebar.
 *
 * The desk had grown to seven sections on one scroll, and FIMCO's people open
 * it to do one thing at a time — file a statement, check what is owed, look
 * up a customer. A list down the side turns that scroll into a place with
 * rooms in it, and says what is in each without scrolling to find out.
 *
 * Anchors rather than routes, because the sections are one page of state: a
 * filing made in one is meant to show up in another without a reload. The
 * active item follows the scroll, so the sidebar is also a position
 * indicator rather than only a set of links.
 */
export type DeskSection = { id: string; label: string; hint: string };

export function DeskNav({ sections, title, subtitle }: {
  sections: DeskSection[]; title: string; subtitle: string;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);
    if (!targets.length) return;

    /*
     * The topmost section whose heading has passed the top of the viewport.
     * An IntersectionObserver alone marks whichever section is most visible,
     * which on a page of tall sections keeps selecting the one below the one
     * being read.
     */
    const onScroll = () => {
      const line = window.scrollY + 140;
      let current = targets[0].id;
      for (const el of targets) {
        if (el.offsetTop <= line) current = el.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.offsetTop - 96, behavior: "smooth" });
    setActive(id);
  };

  return (
    <>
      {/* Phone: a scrolling strip of chips above the content. */}
      <div className="-mx-5 mb-4 flex gap-1.5 overflow-x-auto px-5 pb-1 lg:hidden">
        {sections.map((s) => (
          <button key={s.id} onClick={() => go(s.id)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
              active === s.id ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Desktop: a real sidebar, stuck to the top as the page moves. */}
      <aside className="hidden w-[232px] shrink-0 lg:block">
        <div className="sticky top-24">
          <div className="eyebrow">{title}</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{subtitle}</p>
          <nav className="mt-4 grid gap-0.5">
            {sections.map((s) => (
              <button key={s.id} onClick={() => go(s.id)}
                className={`group rounded-xl px-3 py-2.5 text-left transition-colors ${
                  active === s.id ? "surface" : "hover:surface"
                }`}>
                <span className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                    active === s.id ? "bg-[var(--color-accent)]" : "bg-[var(--border)]"
                  }`} />
                  <span className={`text-[13px] ${active === s.id ? "font-medium" : "text-[var(--muted)]"}`}>
                    {s.label}
                  </span>
                </span>
                <span className="mt-0.5 block pl-3.5 text-[11px] leading-snug text-[var(--muted)]">
                  {s.hint}
                </span>
              </button>
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
}
