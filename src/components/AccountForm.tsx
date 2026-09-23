"use client";

import Link from "next/link";

import { useState } from "react";
import { passwordProblem } from "@/lib/passwordRule";
import { cleanUsername } from "@/lib/usernameRule";
import { useT } from "@/lib/i18n";
import { IdCapture, type Captured } from "./IdCapture";

/** The documents a Tanzanian account can be opened against. */
const DOCS = [
  { id: "nida", label: "National ID", field: "NIDA number", ph: "20 digits" },
  { id: "passport", label: "Passport", field: "Passport number", ph: "e.g. AB123456" },
  { id: "licence", label: "Driver's licence", field: "Licence number", ph: "Licence number" },
  { id: "voter", label: "Voter's card", field: "Voter number", ph: "Voter number" },
] as const;

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
  /*
   * Which document, not just its number.
   *
   * The field was labelled NIDA and stripped everything that was not a digit,
   * so anyone holding a passport or a licence either could not enter theirs or
   * watched it be silently mangled. Most people here carry a NIDA, so it leads;
   * the others are a tap away.
   */
  const [docType, setDocType] = useState<"nida" | "passport" | "licence" | "voter">("nida");
  /*
   * Unticked by default, and it stays unticked.
   *
   * A pre-ticked box is not agreement, it is a box someone failed to notice.
   * The button below stays disabled until this is deliberate, which is the
   * whole point of asking.
   */
  const [agreed, setAgreed] = useState(false);
  /*
   * The two photographs, collected here rather than on a later screen.
   *
   * A verification step that only appears once the account exists puts the
   * identity check after the money, which is the wrong order for a regulated
   * account. They are gathered with everything else and filed the moment the
   * account is created — a submission needs a user row to belong to, so it
   * cannot be sent before then, but that is our problem rather than something
   * to make somebody navigate around.
   */
  const [ids, setIds] = useState<Captured>({ doc: null, selfie: null, docKind: "image" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * A free handle to offer when the one they chose is taken.
   *
   * Being told "that username is taken" and nothing else is the point where
   * people give up on the field, so the server returns one that is not and
   * the form offers it as a single tap.
   */
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const { t } = useT();

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/account/${mode === "signup" ? "register" : "login"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { ...form, docType, acceptedTerms: agreed } : form),
      });
      const j = await r.json();
      if (!j.ok) {
        if (j.code === "username_taken" && j.suggestion) setSuggestion(j.suggestion);
        throw new Error(j.error ?? t("Could not continue"));
      }

      /*
       * Filed straight after, on the session the registration just opened.
       *
       * A failure here is not a failed signup: the account exists, they are
       * signed in, and the prompt that follows them around the app will bring
       * them back to it. Throwing would leave someone with an account they
       * were told they did not get.
       */
      if (mode === "signup" && ids.doc && ids.selfie) {
        await fetch("/api/account/kyc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            docType,
            docNumber: form.nidaNumber || null,
            doc: ids.doc,
            selfie: ids.selfie,
          }),
        }).catch(() => { /* the prompt will ask again */ });
      }

      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Something went wrong"));
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
        {/*
          Compact mode hides labels and hints, which on a phone meant the
          password rule existed nowhere until the attempt failed. A requirement
          you can only discover by breaking it is not a requirement, it is a
          trap — so it is stated up front here and marked as it is met.
        */}
        {compact && hint && (
          <span className={`mt-1 block text-[11px] ${
            key === "password" && form.password
              ? passwordProblem(form.password)
                ? "text-[var(--muted)]"
                : "text-[var(--color-up)]"
              : "text-[var(--muted)]"
          }`}>
            {key === "password" && form.password && !passwordProblem(form.password) ? t("Password looks good") : hint}
          </span>
        )}
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
            {m === "signup" ? t("New account") : t("Sign in")}
          </button>
        ))}
      </div>

      <div className={`grid gap-2.5 ${compact ? "mt-4" : ""}`}>
        {mode === "signup"
          ? field("email", t("Email"), { type: "email", autoComplete: "email", placeholder: "you@example.com" })
          : field("email", t("Email or username"), { autoComplete: "username", placeholder: "you@example.com or @handle" })}
        {field("password", t("Password"), {
          type: "password",
          autoComplete: mode === "signup" ? "new-password" : "current-password",
          hint: mode === "signup" ? t("10+ characters, letters and numbers") : undefined,
        })}
        {mode === "signup" && (
          <>
            {field("username", t("Username"), {
              autoComplete: "username", placeholder: t("optional"),
              hint: t("Optional — 3 characters or more"),
            })}
            {/*
              What the handle will actually be saved as.
              Capitals, spaces and an "@" are tidied up rather than refused, so
              this says what happened instead of leaving someone to find out
              from their profile later.
            */}
            {form.username && cleanUsername(form.username) !== form.username && (
              <p className="-mt-1 text-[11px] text-[var(--muted)]">
                {t("Saved as")} @{cleanUsername(form.username) || "—"}
              </p>
            )}
            {suggestion && (
              <button
                onClick={() => { setForm((f) => ({ ...f, username: suggestion })); setSuggestion(null); setError(null); }}
                className="-mt-1 self-start rounded-full border hairline px-3 py-1 text-[11px] font-medium hover:surface"
              >
                {t("Use")} @{suggestion}
              </button>
            )}
            {field("name", t("Full name"), { autoComplete: "name", placeholder: t("As on your NIDA") })}
            {field("phone", t("Mobile money number"), { inputMode: "numeric", placeholder: "255712345678" })}
            <div>
              <span className="eyebrow">{t("Identity document")}</span>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {DOCS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => { setDocType(d.id); setForm((f) => ({ ...f, nidaNumber: "" })); }}
                    className={`rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors ${
                      docType === d.id ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
                    }`}
                  >
                    {t(d.label)}
                  </button>
                ))}
              </div>
            </div>
            {field("nidaNumber", t(DOCS.find((d) => d.id === docType)!.field), {
              inputMode: docType === "nida" ? "numeric" : "text",
              placeholder: t(DOCS.find((d) => d.id === docType)!.ph),
              hint: docType === "nida"
                ? `${form.nidaNumber.replace(/\D/g, "").length}/20`
                : undefined,
            })}
          </>
        )}
      </div>

      {mode === "signup" && (
        <div className="mt-4 border-t hairline pt-4">
          <IdCapture onChange={setIds} compact={compact} />
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            {ids.doc && ids.selfie
              ? t("Both photos attached. They go to verification as soon as your account is open.")
              : t("Needed to verify the account. You can add them later, but you will not be able to trade until they are checked.")}
          </p>
        </div>
      )}

      {mode === "signup" && (
        <label className="mt-4 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--fg)]"
          />
          <span className="text-[12px] leading-snug text-[var(--muted)]">
            {t("I have read and agree to the")}{" "}
            <Link href="/terms" target="_blank" className="underline underline-offset-2 hover:text-[var(--fg)]">
              {t("terms of service")}
            </Link>{" "}
            {t("and")}{" "}
            <Link href="/privacy" target="_blank" className="underline underline-offset-2 hover:text-[var(--fg)]">
              {t("privacy policy")}
            </Link>
            {t(", and I am not a United States person.")}
          </span>
        </label>
      )}

      <button
        onClick={submit}
        disabled={busy || !form.email || !form.password || (mode === "signup" && !agreed)}
        className="mt-4 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
      >
        {busy ? t("Working…") : submitLabel ?? (mode === "signup" ? t("Create account") : t("Sign in"))}
      </button>

      {error && <p className="mt-3 text-xs leading-snug text-[var(--color-down)]">{error}</p>}
    </div>
  );
}
