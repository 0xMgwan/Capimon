"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollWhileVisible } from "@/lib/usePoll";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { AssetLogo } from "./AssetLogo";
import { useDse, dseLogoOf } from "@/lib/useDse";
import { useMarkets } from "@/lib/useMarkets";

type Item = {
  id: string; kind: string; title: string; body: string | null; asset: string | null;
  read_at: string | null; created_at: string;
};

/**
 * A glyph and a colour per kind.
 *
 * Money in, money out and a trade are three different events, and a row of
 * identical grey dots makes the reader parse the sentence to find out which.
 * Colour carries direction, the glyph carries the kind.
 */
/**
 * What a row shows instead of a dot.
 *
 * A trade shows the company, because "Bought 0.066 CRDB" with a grey arrow
 * beside it makes the reader work out which holding moved from the sentence.
 * The logo is the fastest thing on the row to recognise and it is already
 * loaded elsewhere in the app.
 *
 * Money in and money out get drawn marks rather than arrows on a circle: a
 * banknote going into a tray, and one coming out of it. They share the app's
 * up and down colours, so direction reads before the glyph does.
 */
const MONEY_MARK: Record<string, { className: string; draw: React.ReactNode }> = {
  deposit: {
    className: "bg-[var(--color-up)]/12 text-[var(--color-up)]",
    draw: (
      <>
        <rect x="3.2" y="2.6" width="9.6" height="6" rx="1.2" />
        <circle cx="8" cy="5.6" r="1.4" />
        <path d="M8 9.4v2.6m0 0 1.6-1.6M8 12l-1.6-1.6" />
        <path d="M1.8 12.4v.6a1.4 1.4 0 0 0 1.4 1.4h9.6a1.4 1.4 0 0 0 1.4-1.4v-.6" />
      </>
    ),
  },
  withdrawal: {
    className: "bg-[var(--color-down)]/12 text-[var(--color-down)]",
    draw: (
      <>
        <rect x="3.2" y="7.4" width="9.6" height="6" rx="1.2" />
        <circle cx="8" cy="10.4" r="1.4" />
        <path d="M8 6.6V4m0 0L6.4 5.6M8 4l1.6 1.6" />
        <path d="M1.8 3.6V3a1.4 1.4 0 0 1 1.4-1.4h9.6A1.4 1.4 0 0 1 14.2 3v.6" />
      </>
    ),
  },
  alert: {
    className: "bg-[#b45309]/14 text-[#b45309]",
    draw: (
      <>
        <path d="M8 2.6 14.2 13H1.8z" />
        <path d="M8 6.6v3.1" />
        <path d="M8 11.7h.01" />
      </>
    ),
  },
};

function KindIcon({ kind, asset }: { kind: string; asset: string | null }) {
  const { data } = useMarkets();
  const dse = useDse();

  if (kind === "trade" && asset) {
    const m = data?.markets.find((x) => x.symbol === asset || x.ticker === asset);
    return (
      <span className="mt-0.5 shrink-0">
        <AssetLogo
          logo={dseLogoOf(dse, asset) !== undefined ? dseLogoOf(dse, asset) ?? null : m?.logo ?? null}
          ticker={m?.ticker ?? asset}
          color={dseLogoOf(dse, asset) !== undefined ? "#0B7D3E" : m?.color ?? "var(--color-accent)"}
          size={32}
        />
      </span>
    );
  }

  const mark = MONEY_MARK[kind] ?? {
    className: "surface text-[var(--muted)]",
    draw: <><path d="M8 4.6v6.8" /><path d="M4.6 8h6.8" /></>,
  };
  return (
    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${mark.className}`} aria-hidden>
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
        strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        {mark.draw}
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
  const { t } = useT();
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
    const stop = pollWhileVisible(tick, 30_000);
    return () => { alive = false; clearTimeout(first); stop(); };
  }, [account, load]);

  /*
   * Cleared locally first, then on the server.
   *
   * The list is the customer's own record and emptying it is not a decision
   * anyone else depends on, so waiting for a round trip before the panel
   * responds would make a one-tap action feel broken on a slow connection.
   */
  const clear = useCallback(async () => {
    setItems([]);
    setUnread(0);
    try {
      await fetch("/api/account/notifications", { method: "DELETE" });
    } catch {
      // It will come back on the next poll if the delete never landed, which
      // is the honest outcome rather than a list that looks empty forever.
      void load();
    }
  }, [load]);

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
    <div ref={ref}>
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
        <div className="absolute right-0 top-full z-50 mt-2.5 w-[min(21rem,calc(100vw-1.75rem))] origin-top-right overflow-hidden rounded-2xl border hairline bg-[var(--bg)] shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between border-b hairline px-4 py-3">
            <span className="eyebrow">{t("Activity")}</span>
            {items.length > 0 && (
              <button
                onClick={() => void clear()}
                className="text-[11px] text-[var(--muted)] underline underline-offset-2 transition-colors hover:text-[var(--fg)]"
              >
                {t("Clear")}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
              {t("Nothing yet. Deposits and trades show up here.")}
            </p>
          ) : (
            <div className="scroll-thin max-h-[60vh] divide-y divide-[var(--border)] overflow-y-auto">
              {items.map((n) => (
                <div key={n.id} className="flex gap-3 px-4 py-3">
                  <KindIcon kind={n.kind} asset={n.asset} />
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
