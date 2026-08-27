"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { Avatar } from "./Avatar";

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
  const [username, setUsername] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!account) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
        <div className="eyebrow">Settings</div>
        <h1 className="display mt-3 text-3xl">Sign in first.</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Your details live behind your account.
        </p>
        <Link href="/join" className="mt-6 inline-block rounded-full bg-[var(--fg)] px-5 py-3 text-sm font-medium text-[var(--bg)]">
          Open an account
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
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-6 sm:px-8 sm:pb-24 sm:pt-12">
      <div className="eyebrow">Settings</div>
      <h1 className="display mt-2 text-[clamp(1.8rem,5vw,2.6rem)]">Your account.</h1>

      {/* Identity */}
      <section className="mt-8 rounded-3xl border hairline p-5">
        <div className="flex items-center gap-4">
          <Avatar src={u.avatar} name={u.name} email={u.email} size={64} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">{u.name ?? u.email}</div>
            <div className="truncate text-xs text-[var(--muted)]">
              {u.username ? `@${u.username}` : "No username yet"}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-full border hairline px-4 py-2 text-[13px] font-medium transition-colors hover:surface disabled:opacity-50"
          >
            {u.avatar ? "Change photo" : "Add photo"}
          </button>
          {u.avatar && (
            <button
              onClick={() => void save({ avatar: null })}
              disabled={busy}
              className="rounded-full border hairline px-4 py-2 text-[13px] text-[var(--muted)] transition-colors hover:surface disabled:opacity-50"
            >
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
      <section className="mt-4 rounded-3xl border hairline p-5">
        <Field label="Username" hint="3–20 characters. Letters, numbers or underscore.">
          <input
            value={val(username, u.username)}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="yourname"
            className="w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
        <Field label="Display name">
          <input
            value={val(name, u.name)}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
        <Field label="Mobile money number" hint="Used for deposits and withdrawals.">
          <input
            value={val(phone, u.phone)}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="numeric"
            placeholder="255…"
            className="tnum w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
        <button
          onClick={() => void save({
            ...(username !== null ? { username } : {}),
            ...(name !== null ? { name } : {}),
            ...(phone !== null ? { phone } : {}),
          })}
          disabled={busy || (username === null && name === null && phone === null)}
          className="mt-2 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] transition-transform active:scale-95 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        {(note || error) && (
          <p className={`mt-3 break-words text-xs ${error ? "text-[var(--color-down)]" : "text-[var(--muted)]"}`}>
            {error ?? note}
          </p>
        )}
      </section>

      {/* Fixed details. Shown because people need to check them, not edit them. */}
      <section className="mt-4 rounded-3xl border hairline p-5">
        <Row label="Email" value={u.email} />
        <Row label="Verification" value={u.kycStatus === "approved" ? "Verified" : "Pending"} />
        <Row label="Country" value="Tanzania" />
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
          To change your email or identity details, contact support — they are tied to the checks
          behind your account.
        </p>
      </section>

      <button
        onClick={() => void signOut()}
        className="mt-4 w-full rounded-full border border-[var(--color-down)]/40 py-3 text-sm font-medium text-[var(--color-down)] transition-colors hover:bg-[var(--color-down)]/[0.06]"
      >
        Sign out
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="eyebrow">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b hairline py-2.5 last:border-0">
      <span className="eyebrow">{label}</span>
      <span className="min-w-0 truncate text-sm">{value}</span>
    </div>
  );
}
