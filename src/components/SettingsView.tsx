"use client";

import Link from "next/link";
import { KycPrompt } from "./KycPrompt";
import { useRef, useState, useEffect } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { Avatar } from "./Avatar";
import { useT } from "@/lib/i18n";
import { needsTapSound, tapSoundEnabled, setTapSound, haptic } from "@/lib/haptics";

/** Shrink to this before sending; an avatar never needs more. */
const AVATAR_PX = 128;

/**
 * Resizes a chosen image in the browser.
 *
 * A phone photo is several megabytes and none of that survives being drawn at
 * 28px in a corner, so it is reduced before it ever leaves the device — the
 * upload is instant and the row stays small.
 */
async function toSquareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
    0, 0, AVATAR_PX, AVATAR_PX,
  );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function SettingsView() {
  const { account, refresh, signOut } = useCapimonAccount();
  const fileRef = useRef<HTMLInputElement>(null);
  const { t, lang, setLang } = useT();
  const [username, setUsername] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [nida, setNida] = useState<string | null>(null);
  /*
   * Only shown on a device that cannot do the real thing.
   *
   * Offering a workaround to a phone that already vibrates is one more switch
   * to read past, so this appears for older iPhones and nobody else.
   */
  const [tapSound, setTapSoundOn] = useState(false);
  const [showTapSound, setShowTapSound] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setShowTapSound(needsTapSound());
      setTapSoundOn(tapSoundEnabled());
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!account) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
        <div className="eyebrow">Settings</div>
        <h1 className="display mt-2 text-2xl">{t("Sign in first.")}</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {t("Your details live behind your account.")}
        </p>
        <Link href="/join" className="mt-6 inline-block rounded-full bg-[var(--fg)] px-5 py-3 text-sm font-medium text-[var(--bg)]">
          {t("Open an account")}
        </Link>
      </div>
    );
  }

  const u = account.user;
  // Uncontrolled until touched, so an unedited field is never sent.
  const val = (edited: string | null, saved: string | null) => edited ?? saved ?? "";

  const save = async (patch: Record<string, string | null>) => {
    setBusy(true); setError(null); setNote(null);
    try {
      const r = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not save");
      setNote("Saved.");
      setUsername(null); setName(null); setPhone(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      await save({ avatar: await toSquareDataUrl(file) });
    } catch {
      setError("That image could not be read. Try a JPEG or PNG.");
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pb-10 pt-3 sm:px-8 sm:pt-9">
      <h1 className="display text-[clamp(1.35rem,3.4vw,2.1rem)]">{t("Your account.")}</h1>
      <div className="mt-3"><KycPrompt /></div>

      {/* Identity */}
      {/* One row, as an app's account header: the photo is the button. */}
      <section className="mt-3 flex items-center gap-3 rounded-2xl border hairline p-3">
        <button onClick={() => fileRef.current?.click()} disabled={busy} aria-label={u.avatar ? "Change photo" : "Add photo"}
          className="shrink-0 rounded-full disabled:opacity-50">
          <Avatar src={u.avatar} name={u.name} email={u.email} size={48} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{u.name ?? u.email}</div>
          <div className="truncate text-xs text-[var(--muted)]">
            {u.username ? `@${u.username}` : "No username yet"}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-[12px]">
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="font-medium underline-offset-2 hover:underline disabled:opacity-50">
            {u.avatar ? "Change photo" : "Add photo"}
          </button>
          {u.avatar && (
            <button onClick={() => void save({ avatar: null })} disabled={busy}
              className="text-[var(--muted)] underline-offset-2 hover:underline disabled:opacity-50">
              Remove
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void pickPhoto(e.target.files?.[0])}
          />
        </div>
      </section>

      {/* Editable details */}
      <section className="mt-3 rounded-2xl border hairline p-3.5 sm:p-5">
        <div className="grid grid-cols-2 gap-2.5">
        <Field label="Username" hint={t("Optional — 3 characters or more")}>
          <input
            value={val(username, u.username)}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="yourname"
            className="w-full rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
        <Field label={t("Display name")}>
          <input
            value={val(name, u.name)}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Your name")}
            className="w-full rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
        </div>
        {/* A language choice is an account preference, so it lives with the
            others rather than hidden in a corner of the nav. */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="eyebrow">{t("Language")}</span>
          <div className="flex rounded-full surface p-0.5">
            {([["en", "English"], ["sw", "Kiswahili"]] as const).map(([code, label]) => (
              <button
                key={code}
                onClick={() => setLang(code)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  lang === code ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {showTapSound && (
          <Field
            label={t("Tap feedback")}
            hint={t("This iPhone is older than iOS 18, the first version a website can use the Taptic Engine. A short click can be played instead. It is sound, not vibration.")}
          >
            <button
              onClick={() => {
                const next = !tapSound;
                setTapSoundOn(next);
                setTapSound(next);
                if (next) haptic("light");
              }}
              className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors ${
                tapSound ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
              }`}
            >
              {t(tapSound ? "Click on" : "Click off")}
            </button>
          </Field>
        )}

        <Field
          label={t("National ID (NIDA)")}
          hint={t(u.kycStatus === "approved"
            ? "Verified and locked to the document we checked."
            : "Twenty digits. Must match the document you submit for verification.")}
        >
          <input
            value={val(nida, u.nidaNumber)}
            onChange={(e) => setNida(e.target.value.replace(/[^\d]/g, "").slice(0, 20))}
            disabled={u.kycStatus === "approved"}
            inputMode="numeric"
            placeholder="20 digits"
            className="tnum w-full rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          />
        </Field>
        <Field label={t("Mobile money number")} hint={t("Used for deposits and withdrawals.")}>
          <input
            value={val(phone, u.phone)}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="numeric"
            placeholder="255…"
            className="tnum w-full rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
        <button
          onClick={() => void save({
            ...(username !== null ? { username } : {}),
            ...(name !== null ? { name } : {}),
            ...(phone !== null ? { phone } : {}),
            ...(nida !== null ? { nidaNumber: nida } : {}),
          })}
          disabled={busy || (username === null && name === null && phone === null && nida === null)}
          className="mt-1 w-full rounded-full bg-[var(--fg)] py-2.5 text-sm font-medium text-[var(--bg)] transition-transform active:scale-95 disabled:opacity-40"
        >
          {t(busy ? "Saving…" : "Save changes")}
        </button>
        {(note || error) && (
          <p className={`mt-3 break-words text-xs ${error ? "text-[var(--color-down)]" : "text-[var(--muted)]"}`}>
            {error ?? note}
          </p>
        )}
      </section>

      {/* Fixed details. Shown because people need to check them, not edit them. */}
      <section className="mt-3 rounded-2xl border hairline px-3.5 py-1.5 sm:px-5">
        <Row label={t("Email")} value={u.email} />
        <Row
          label={t("Verification")}
          value={
            t(u.kycStatus === "approved" ? "Verified"
              : u.kycStatus === "pending" ? "Under review"
              : u.kycStatus === "rejected" ? "Not accepted"
              : "Not started")
          }
        />
        <Row label={t("Country")} value="Tanzania" />
        {u.kycStatus !== "approved" && (
          <Link
            href="/verify"
            className="my-2 inline-flex rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)]"
          >
            {t(u.kycStatus === "rejected" ? "Submit again" : u.kycStatus === "pending" ? "View status" : "Verify your account")}
          </Link>
        )}
        <p className="pb-2 pt-1 text-[11px] leading-relaxed text-[var(--muted)]">
          To change your email, contact support.
        </p>
      </section>

      <button
        onClick={() => void signOut()}
        className="mt-3 w-full rounded-full border border-[var(--color-down)]/40 py-2.5 text-sm font-medium text-[var(--color-down)] transition-colors hover:bg-[var(--color-down)]/[0.06]"
      >
        {t("Sign out")}
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block min-w-0">
      <span className="eyebrow">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-0.5 block text-[10.5px] leading-snug text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b hairline py-2 last:border-0">
      <span className="eyebrow">{label}</span>
      <span className="min-w-0 truncate text-sm">{value}</span>
    </div>
  );
}
