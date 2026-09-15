"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";

type Item = {
  id: string; kind: string; title: string; body: string | null;
  read_at: string | null; created_at: string;
};

/**
 * A glyph and a colour per kind.
 *
 * Money in, money out and a trade are three different events, and a row of
 * identical grey dots makes the reader parse the sentence to find out which.
 * Colour carries direction, the glyph carries the kind.
 */
const KIND_STYLE: Record<string, { path: string; className: string }> = {
  deposit: {
    path: "M8 3v8m0 0 3-3m-3 3L5 8M3 13h10",
    className: "bg-[var(--color-up)]/12 text-[var(--color-up)]",
  },
  withdrawal: {
    path: "M8 13V5m0 0L5 8m3-3 3 3M3 3h10",
    className: "bg-[var(--color-down)]/12 text-[var(--color-down)]",
  },
  trade: {
    path: "M2 11l4-4 3 3 5-5M14 5h-3m3 0v3",
    className: "bg-[var(--color-accent)]/12 text-[var(--color-accent)]",
  },
  alert: {
    path: "M8 4v5m0 2.5v.5M8 1.5 15 14H1z",
    className: "bg-[var(--color-down)]/12 text-[var(--color-down)]",
  },
};

function KindIcon({ kind }: { kind: string }) {
  const s = KIND_STYLE[kind] ?? {
    path: "M8 4.5v7M4.5 8h7",
    className: "surface text-[var(--muted)]",
  };
  return (
    <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${s.className}`}>
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={s.path} />
      </svg>
    </span>
  );
}

/**
 * What happened while the customer was elsewhere.
 *
 * Deposits settle on a cron and orders fill mid-request, so without this the
 * only way to learn either had happened was to keep the page open. Opening the
 * list is the acknowledgement — there is nothing to dismiss, because a person
 * checking their money should not also have to file it.
 */
export function NotificationBell() {
  const { account } = useCapimonAccount();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/account/notifications", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) { setItems(j.items ?? []); setUnread(j.unread ?? 0); }
    } catch {
      /* the balance on screen is still correct */
    }
  }, []);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    // Deferred rather than called in the effect body: a synchronous setState
    // during an effect cascades a second render before the first has painted.
    const tick = () => { if (alive) void load(); };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearTimeout(first); clearInterval(id); };
  }, [account, load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!account) return null;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0); // clear immediately; the write can settle behind it
      await fetch("/api/account/notifications", { method: "POST" }).catch(() => null);
      void load();
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => void toggle()}
        aria-label={unread > 0 ? `${unread} new notifications` : "Notifications"}
        className="relative grid h-9 w-9 place-items-center rounded-full border hairline transition-colors hover:surface"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
          <path d="M12 2.6a6.4 6.4 0 0 0-6.4 6.4v3.1l-1.3 2.6a1.2 1.2 0 0 0 1.07 1.74h13.26a1.2 1.2 0 0 0 1.07-1.74l-1.3-2.6V9A6.4 6.4 0 0 0 12 2.6Z" />
          <path d="M9.6 18.4a2.4 2.4 0 0 0 4.8 0H9.6Z" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--color-down)] px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(19rem,calc(100vw-5rem))] origin-top-right overflow-hidden rounded-2xl border hairline bg-[var(--bg)] shadow-2xl shadow-black/10">
          <div className="border-b hairline px-4 py-3">
            <span className="eyebrow">Activity</span>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
              Nothing yet. Deposits and trades show up here.
            </p>
          ) : (
            <div className="scroll-thin max-h-[60vh] divide-y divide-[var(--border)] overflow-y-auto">
              {items.map((n) => (
                <div key={n.id} className="flex gap-3 px-4 py-3">
                  <KindIcon kind={n.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-snug">{n.title}</span>
                    {n.body && (
                      <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)]">{n.body}</span>
                    )}
                    <span className="mt-1 block text-[10px] text-[var(--muted)]">
                      {new Date(n.created_at).toLocaleString("en-GB", {
                        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
