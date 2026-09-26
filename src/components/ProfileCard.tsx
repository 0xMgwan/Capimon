"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "./Avatar";
import { useT } from "@/lib/i18n";

/**
 * A customer, as other customers may see them.
 *
 * Opened by tapping a handle. What it shows depends entirely on whether that
 * account has published its trading: everyone gets a name, a handle and a
 * joining date, and only somebody who switched it on gets a record of what
 * they have traded. The absence is stated rather than left blank — "this
 * account keeps its trading private" is a fact about a choice, not a gap.
 */
type Profile = {
  username: string | null;
  name: string | null;
  avatar: string | null;
  joined: string;
  activity: null | {
    trades: number;
    volumeTzs: number;
    realisedTzs: number;
    holdings: { symbol: string; qty: number }[];
  };
};

const TZS = (n: number) => `${Math.round(n).toLocaleString()} TZS`;

export function ProfileCard({ username, onClose }: { username: string; onClose: () => void }) {
  const { t } = useT();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Deferred for the same reason every other first paint here is: setting
  // state in the effect body cascades a render before the first has landed.
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/profile/${encodeURIComponent(username.replace(/^@/, ""))}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!alive) return; if (j.ok) setProfile(j.profile); else setMissing(true); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [username]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl border hairline bg-[var(--bg)] p-5 shadow-2xl sm:rounded-3xl"
      >
        {missing ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">{t("No such handle.")}</p>
        ) : !profile ? (
          <div className="h-32 animate-pulse rounded-2xl surface" />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Avatar src={profile.avatar} name={profile.name} email={profile.username ?? ""} size={48} />
              <div className="min-w-0">
                <div className="truncate text-[16px] font-medium">
                  {profile.username ? `@${profile.username}` : profile.name ?? t("A customer")}
                </div>
                <div className="truncate text-[12px] text-[var(--muted)]">
                  {t("Joined")}{" "}
                  {new Date(profile.joined).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                </div>
              </div>
            </div>

            {profile.activity ? (
              <>
                <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-[var(--border)]">
                  <Cell label={t("Trades")} value={profile.activity.trades.toLocaleString()} />
                  <Cell label={t("Volume")} value={TZS(profile.activity.volumeTzs)} />
                  <Cell
                    label={t("Realised")}
                    value={TZS(profile.activity.realisedTzs)}
                    tone={profile.activity.realisedTzs >= 0 ? "up" : "down"}
                  />
                </div>
                {profile.activity.holdings.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {profile.activity.holdings.map((h) => (
                      <span key={h.symbol} className="tnum rounded-full surface px-2.5 py-1 text-[11px]">
                        {h.symbol} {h.qty >= 1 ? h.qty.toFixed(2) : h.qty.toFixed(4)}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="mt-4 rounded-2xl surface px-3.5 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
                {t("This account keeps its trading private.")}
              </p>
            )}

            <button
              onClick={onClose}
              className="mt-4 w-full rounded-full border hairline py-2.5 text-[13px] font-medium hover:surface"
            >
              {t("Close")}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="bg-[var(--bg)] px-3 py-2.5">
      <div className="eyebrow truncate text-[9px]">{label}</div>
      <div className={`tnum mt-1 truncate text-[13px] font-medium ${
        tone === "up" ? "text-[var(--color-up)]" : tone === "down" ? "text-[var(--color-down)]" : ""
      }`}>
        {value}
      </div>
    </div>
  );
}
