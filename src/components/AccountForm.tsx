"use client";

import { useState } from "react";

export type AccountMode = "signin" | "signup";

/**
 * The one account form.
 *
 * Shared by the sign-in modal and the onboarding page so the two can never
 * drift apart — a signup that asks for different things depending on where it
 * was opened is a bug waiting to happen, and here it collects the identity CAPX
 * keeps on file.
 */
export function AccountForm({
  mode, onModeChange, onDone, submitLabel, compact = false,
}: {
  mode: AccountMode;
  onModeChange: (m: AccountMode) => void;
  onDone: () => Promise<void> | void;
  submitLabel?: string;
  /** Tighter spacing for the modal. */
  compact?: boolean;
}) {
  const [form, setForm] = useState({ email: "", password: "", username: "", name: "", phone: "", nidaNumber: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/account/${mode === "signup" ? "register" : "login"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not continue");
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: keyof typeof form,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string } = {},
  ) => {
    const { hint, ...rest } = props;
    return (
      <label className="block">
        {!compact && (
          <span className="eyebrow flex items-center justify-between gap-2">
            {label}
            {hint && <span className="normal-case tracking-normal">{hint}</span>}
          </span>
        )}
        <input
          {...rest}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          placeholder={compact ? label : rest.placeholder}
          className={`w-full rounded-xl border hairline bg-transparent px-4 text-sm outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--color-accent)] ${
            compact ? "py-3" : "mt-1.5 py-2.5"
          }`}
        />
      </label>
    );
  };

  return (
    <div>
      <div className={`flex rounded-full surface p-1 ${compact ? "" : "mb-3"}`}>
        {(["signup", "signin"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { onModeChange(m); setError(null); }}
            className={`flex-1 rounded-full py-2 text-sm font-medium transition-colors ${
              mode === m ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
            }`}
          >
            {m === "signup" ? "New account" : "Sign in"}
          </button>
        ))}
      </div>

      <div className={`grid gap-2.5 ${compact ? "mt-4" : ""}`}>
        {mode === "signup"
          ? field("email", "Email", { type: "email", autoComplete: "email", placeholder: "you@example.com" })
          : field("email", "Email or username", { autoComplete: "username", placeholder: "you@example.com or @handle" })}
        {field("password", "Password", {
          type: "password",
          autoComplete: mode === "signup" ? "new-password" : "current-password",
          hint: mode === "signup" ? "10+ characters, letters and numbers" : undefined,
        })}
        {mode === "signup" && (
          <>
            {field("username", "Username", {
              autoComplete: "username", placeholder: "optional",
              hint: "3–20 letters, numbers or _",
            })}
            {field("name", "Full name", { autoComplete: "name", placeholder: "As on your NIDA" })}
            {field("phone", "Mobile money number", { inputMode: "numeric", placeholder: "255712345678" })}
            {field("nidaNumber", "NIDA number", {
              inputMode: "numeric", placeholder: "20 digits",
              hint: `${form.nidaNumber.replace(/\D/g, "").length}/20`,
            })}
          </>
        )}
      </div>

      <button
        onClick={submit}
        disabled={busy || !form.email || !form.password}
        className="mt-4 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
      >
        {busy ? "Working…" : submitLabel ?? (mode === "signup" ? "Create account" : "Sign in")}
      </button>

      {error && <p className="mt-3 text-xs leading-snug text-[var(--color-down)]">{error}</p>}
    </div>
  );
}
