"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { passwordProblem } from "@/lib/passwordRule";
import { useT } from "@/lib/i18n";

/**
 * Where a reset link lands.
 *
 * One field, because there is only one thing left to decide. The token comes
 * from the address rather than from anything typed — nobody should be asked to
 * copy a code out of an email — and it is read from `window.location` in an
 * effect so this page renders statically and does not need a Suspense boundary
 * around a search-params hook.
 *
 * A link that has expired says so here rather than at submit time, so nobody
 * composes a password for a door that is already closed.
 */
export function ResetPassword() {
  const { t } = useT();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setToken(new URLSearchParams(window.location.search).get("token"));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const problem = password ? passwordProblem(password) : null;
  const mismatch = again.length > 0 && again !== password;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/account/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? t("Could not set your password"));
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not set your password"));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <div className="h-40 animate-pulse rounded-3xl surface" />;

  if (!token) {
    return (
      <div className="rounded-3xl border hairline p-6">
        <h1 className="display text-[1.4rem]">{t("This link is incomplete.")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          {t("Open the link from your email exactly as it was sent, or ask for a new one from the sign-in box.")}
        </p>
        <Link href="/" className="mt-5 inline-block rounded-full border hairline px-4 py-2 text-sm font-medium hover:surface">
          {t("Back to CAPX")}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-3xl border hairline p-6">
        <h1 className="display text-[1.4rem]">{t("Your password is set.")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          {t("Anyone who was signed in with the old one has been signed out. Sign in with the new password to continue.")}
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-full bg-[var(--fg)] px-5 py-2.5 text-sm font-medium text-[var(--bg)]"
        >
          {t("Sign in")}
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border hairline p-6">
      <h1 className="display text-[1.4rem]">{t("Choose a new password.")}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
        {t("This link works once. Setting a password also signs out anyone using the old one.")}
      </p>

      <div className="mt-5 grid gap-2.5">
        <label className="block">
          <span className="eyebrow">{t("New password")}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <span className={`mt-1 block text-[11px] ${
            password && !problem ? "text-[var(--color-up)]" : "text-[var(--muted)]"
          }`}>
            {password && !problem ? t("Password looks good") : t("10+ characters, letters and numbers")}
          </span>
        </label>

        <label className="block">
          <span className="eyebrow">{t("Type it again")}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !problem && !mismatch && again) void submit(); }}
            className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          {mismatch && (
            <span className="mt-1 block text-[11px] text-[var(--color-down)]">{t("These do not match.")}</span>
          )}
        </label>
      </div>

      <button
        onClick={() => void submit()}
        disabled={busy || !password || !!problem || mismatch || !again}
        className="mt-5 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform active:scale-95 disabled:opacity-50"
      >
        {busy ? t("Working…") : t("Set password")}
      </button>

      {error && <p className="mt-3 text-xs leading-snug text-[var(--color-down)]">{error}</p>}
    </div>
  );
}
