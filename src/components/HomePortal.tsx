"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { pollWhileVisible } from "@/lib/usePoll";
import { useT } from "@/lib/i18n";
import { AssetLogo } from "./AssetLogo";
import { Avatar } from "./Avatar";
import { TradeFeed } from "./TradeFeed";
import { ProfileCard } from "./ProfileCard";

/**
 * Home, for somebody who already has an account.
 *
 * The marketing page is an argument for opening one: a headline, a case for
 * the DSE, a case for US names, a wall of pillars. All of it is addressed to a
 * stranger, and a customer who signs in on a phone lands on thirteen swipes of
 * being persuaded of something they have already done.
 *
 * So on a phone this replaces it. What a customer opens the app for is their
 * own money, then what everyone else is doing, then the one thing worth being
 * nudged about — which is a standing order, because it is the only feature
 * here that works while nobody is looking. Everything else they came for is
 * two taps away on the bottom bar, so it is not repeated.
 *
 * The wide screen keeps the full page. A laptop has room for the argument and
 * the desktop visitor is more often the person still deciding.
 */

type Leader = { username: string; name: string | null; avatar: string | null; realisedTzs: number; volumeTzs: number };

const tzs = (n: number) => `${Math.round(n).toLocaleString()}`;

export function HomePortal() {
  const { t } = useT();
  const { account } = useCapimonAccount();
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
    const stop = pollWhileVisible(load, 120_000);
    return () => { alive = false; stop(); };
  }, []);

  if (!account) return null;

  const first = account.user.name?.trim().split(/\s+/)[0] ?? account.user.username;
  const equityTzs = account.usdcPerTzs && account.usdcPerTzs > 0
    ? account.equity / account.usdcPerTzs
    : null;
  const held = [...account.positions].sort((a, b) => b.value - a.value).slice(0, 4);
  const pnl = account.pnl;

  return (
    <div className="px-4 pb-8 pt-4">
      <p className="text-[13px] text-[var(--muted)]">
        {t("Welcome back")}{first ? `, ${first}` : ""}
      </p>

      {/* 1 — their money, which is what the app is opened for. */}
      <Link href="/portfolio" className="mt-3 block rounded-3xl border hairline p-5 transition-colors hover:surface">
        <div className="eyebrow">{t("Portfolio")}</div>
        <div className="tnum mt-1.5 text-[2rem] leading-none font-medium">
          {equityTzs !== null ? `${tzs(equityTzs)} TZS` : `$${account.equity.toFixed(2)}`}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--muted)]">
          {pnl && pnl.invested > 0 && (
            <span className={pnl.unrealised >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
              {pnl.unrealised >= 0 ? "▲" : "▼"} {Math.abs(pnl.unrealisedPct).toFixed(2)}%
            </span>
          )}
          <span className="tnum">{t("Cash")} {tzs(account.tzs)} TZS</span>
        </div>
      </Link>

      {/* 2 — what they hold, or the one thing to do if they hold nothing. */}
      {held.length > 0 ? (
        <div className="mt-2 grid gap-1.5">
          {held.map((p) => (
            <Link
              key={p.symbol}
              href={`/markets/${p.ticker.toLowerCase()}`}
              className="flex items-center gap-3 rounded-2xl border hairline px-3.5 py-2.5 transition-colors hover:surface"
            >
              <AssetLogo logo={p.logo} ticker={p.ticker} color={p.color} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{p.ticker}</span>
                <span className="tnum block text-[11px] text-[var(--muted)]">
                  {p.qty.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                </span>
              </span>
              <span className="text-right">
                <span className="tnum block text-[13.5px]">
                  {p.currency === "TZS" ? `${tzs(p.value / (account.usdcPerTzs || 1))} TZS` : `$${p.value.toFixed(2)}`}
                </span>
                <span className={`tnum block text-[11px] ${
                  p.pnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                  {p.pnl >= 0 ? "+" : ""}{p.pnlPct.toFixed(2)}%
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <Link
          href="/portfolio"
          className="mt-2 block rounded-2xl border hairline px-4 py-3.5 text-[13px] font-medium transition-colors hover:surface"
        >
          {t("Add money and make your first buy")} →
        </Link>
      )}

      {/* 3 — the room. Anonymous unless somebody published themselves. */}
      <div className="mt-5">
        <div className="eyebrow mb-2">{t("Happening now")}</div>
        <TradeFeed />
      </div>

      {leaders && leaders.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="eyebrow">{t("Leaderboard")}</span>
            <Link href="/leaderboard" className="text-[11px] text-[var(--muted)] underline underline-offset-2">
              {t("See all")}
            </Link>
          </div>
          <div className="grid gap-1.5">
            {leaders.map((l, i) => (
              <button
                key={l.username}
                onClick={() => setViewing(l.username)}
                className="flex items-center gap-3 rounded-2xl border hairline px-3.5 py-2 text-left transition-colors hover:surface"
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
        </div>
      )}

      {/*
        4 — the one nudge.
        A standing order is the only thing here that works while the app is
        closed, which is the only kind of feature worth putting in front of
        somebody who is already a customer.
      */}
      <Link
        href="/portfolio#recurring"
        className="mt-5 block rounded-3xl border hairline bg-[var(--fg)] p-5 text-[var(--bg)] transition-transform active:scale-[0.99]"
      >
        <div className="eyebrow opacity-70">{t("Automatic investing")}</div>
        <p className="mt-1.5 text-[17px] font-medium leading-snug">{t("Invest on payday, every payday.")}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed opacity-80">
          {t("Set an amount and a day. CAPX buys for you, from what is already in your account, and you can pause it whenever you like.")}
        </p>
        <span className="mt-3 inline-block text-[12.5px] font-medium underline underline-offset-4">
          {t("Set one up")} →
        </span>
      </Link>

      {viewing && <ProfileCard username={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
