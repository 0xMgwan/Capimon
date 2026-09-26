"use client";

import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { ProfileCard } from "./ProfileCard";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

/**
 * Who is trading, among those who said they wanted to be seen.
 *
 * Absence is the design, not an oversight: an account that has not published
 * its trading is not ranked low, it is not here. A board that quietly
 * included everybody would be a disclosure wearing a game's clothes.
 *
 * Ranked by volume by default rather than by return. Return rewards whoever
 * bought earliest and flatters a small position that moved; volume is simply
 * what somebody did, which is a fairer thing to put a number beside.
 */
type Row = {
  username: string; name: string | null; avatar: string | null;
  trades: number; volumeTzs: number; realisedTzs: number;
};

const TZS = (n: number) => `${Math.round(n).toLocaleString()} TZS`;

export function Leaderboard() {
  const { t } = useT();
  const [by, setBy] = useState<"volume" | "realised">("volume");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Cleared in a task, not in the effect body: a synchronous setState here
    // cascades a render before the first has painted.
    const clear = window.setTimeout(() => { if (alive) setRows(null); }, 0);
    fetch(`/api/leaderboard?by=${by}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive) setRows(j.ok ? j.rows : []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; window.clearTimeout(clear); };
  }, [by]);

  return (
    <div className="mx-auto max-w-[760px] px-4 pb-24 pt-4 sm:px-8 sm:pt-10">
      <div className="eyebrow">{t("Top traders")}</div>
      <h1 className="display mt-2 text-[clamp(1.6rem,4.5vw,2.6rem)]">{t("Who is trading.")}</h1>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-[var(--muted)]">
        {t("Only accounts that have chosen to publish their trading appear here. You can turn yours on, or off again, in settings.")}
      </p>

      <div className="mt-5 flex rounded-full surface p-0.5 text-[12.5px] sm:max-w-xs">
        {([["volume", t("By volume")], ["realised", t("By return")]] as const).map(([k, label]) => (
          <button key={k} onClick={() => { haptic(); setBy(k); }}
            className={`flex-1 rounded-full px-3.5 py-1.5 font-medium transition-colors ${
              by === k ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"}`}>
            {label}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="mt-5 grid gap-1.5">
          {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-2xl surface" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border hairline px-4 py-6 text-center text-sm text-[var(--muted)]">
          {t("Nobody has published their trading yet.")}
        </p>
      ) : (
        <div className="mt-5 grid gap-1.5">
          {rows.map((r, i) => (
            <button key={r.username} onClick={() => { haptic(); setViewing(r.username); }}
              className="flex items-center gap-3 rounded-2xl border hairline px-3.5 py-2.5 text-left transition-colors hover:surface">
              <span className={`tnum w-6 shrink-0 text-[13px] ${i < 3 ? "font-semibold" : "text-[var(--muted)]"}`}>
                {i + 1}
              </span>
              <Avatar src={r.avatar} name={r.name} email={r.username} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">@{r.username}</span>
                <span className="block text-[11px] text-[var(--muted)]">
                  {r.trades} {r.trades === 1 ? t("trade") : t("trades")}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="tnum block text-[13px] font-medium">
                  {by === "volume" ? TZS(r.volumeTzs) : TZS(r.realisedTzs)}
                </span>
                <span className="block text-[10px] text-[var(--muted)]">
                  {by === "volume" ? t("traded") : t("realised")}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {viewing && <ProfileCard username={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
