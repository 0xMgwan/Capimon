"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { pollWhileVisible } from "@/lib/usePoll";
import { useT } from "@/lib/i18n";
import { Avatar } from "./Avatar";
import { TradeFeed } from "./TradeFeed";
import { ProfileCard } from "./ProfileCard";

/**
 * Everyone else, on the page about yourself.
 *
 * A portfolio is a closed loop — your money, your shares, your return — and a
 * market that shows no sign of anybody else in it feels like an empty
 * building. This is the smallest way to say otherwise: a line of what just
 * traded, and the three accounts that chose to be ranked.
 *
 * Both halves are already private by default. The strip names nobody who has
 * not published themselves, and the leaderboard omits them entirely rather
 * than anonymising them.
 */

type Leader = { username: string; name: string | null; avatar: string | null; realisedTzs: number };

const tzs = (n: number) => Math.round(n).toLocaleString();

export function MarketRoom() {
  const { t } = useT();
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/leaderboard?by=volume", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (alive) setLeaders(j.ok ? (j.rows ?? []).slice(0, 3) : []); })
        .catch(() => { if (alive) setLeaders([]); });
    };
    load();
    // Slow: a ranking that moves on a two-minute cadence is still live, and
    // nobody is watching this change.
    const stop = pollWhileVisible(load, 120_000);
    return () => { alive = false; stop(); };
  }, []);

  return (
    <section className="mt-3 rounded-3xl border hairline p-4 sm:p-5">
      <div className="eyebrow mb-2.5">{t("Happening now")}</div>
      <TradeFeed />

      {leaders && leaders.length > 0 && (
        <>
          <div className="mb-2 mt-4 flex items-baseline justify-between">
            <span className="eyebrow">{t("Leaderboard")}</span>
            <Link href="/leaderboard" className="text-[11px] text-[var(--muted)] underline underline-offset-2 hover:text-[var(--fg)]">
              {t("See all")}
            </Link>
          </div>
          <div className="grid gap-1.5">
            {leaders.map((l, i) => (
              <button
                key={l.username}
                onClick={() => setViewing(l.username)}
                className="flex items-center gap-3 rounded-2xl surface px-3.5 py-2 text-left transition-colors hover:brightness-95"
              >
                <span className={`tnum w-4 shrink-0 text-[12px] ${i === 0 ? "font-semibold" : "text-[var(--muted)]"}`}>
                  {i + 1}
                </span>
                <Avatar src={l.avatar} name={l.name} email={l.username} size={26} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">@{l.username}</span>
                <span className={`tnum shrink-0 text-[12px] ${
                  l.realisedTzs >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                  {l.realisedTzs >= 0 ? "+" : ""}{tzs(l.realisedTzs)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {viewing && <ProfileCard username={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
