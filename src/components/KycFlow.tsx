"use client";

import { useState } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";
import { IdCapture, type Captured } from "./IdCapture";

/**
 * Identity verification: a photograph of a document, and a selfie taken now.
 *
 * The selfie is captured from the camera rather than uploaded, because a file
 * picker accepts any picture of anyone. That is a meaningful difference but not
 * liveness detection: it proves the photo was taken on this device at this
 * moment, not that a living person was in front of the lens. The page says so
 * rather than implying a check it does not perform.
 */

const DOCS = [
  { id: "nida", label: "National ID (NIDA)" },
  { id: "passport", label: "Passport" },
  { id: "licence", label: "Driver's licence" },
  { id: "voter", label: "Voter's card" },
] as const;

export function KycFlow({ onDone }: { onDone?: () => void }) {
  const { t } = useT();
  const { account, refresh } = useCapimonAccount();
  const [docType, setDocType] = useState<string>("nida");
  const [docNumber, setDocNumber] = useState("");
  const [ids, setIds] = useState<Captured>({ doc: null, selfie: null, docKind: "image" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!ids.doc || !ids.selfie) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/account/kyc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docType, docNumber: docNumber.trim() || null, doc: ids.doc, selfie: ids.selfie,
        }),
      });
      const j = await res.json();
      if (!j.ok) setError(j.error ?? "That could not be submitted.");
      else {
        setDone(true);
        await refresh();
        onDone?.();
      }
    } catch {
      setError("Could not reach the server. Nothing was submitted.");
    } finally {
      setBusy(false);
    }
  };

  if (!account) return null;

  if (done) {
    return (
      <div className="rounded-3xl border hairline p-6 text-center">
        <div className="eyebrow">{t("Submitted")}</div>
        <h2 className="display mt-2 text-2xl">{t("Thanks. We’ll take a look.")}</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
          Verification is usually same day. You can keep using your account while it is
          reviewed, and we&rsquo;ll let you know here either way.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border hairline p-5 sm:p-6">
      <div className="eyebrow">Step 1 of 2</div>
      <h2 className="display mt-1.5 text-xl">{t("Your document.")}</h2>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DOCS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDocType(d.id)}
            className={`rounded-xl border px-3 py-2.5 text-[12px] font-medium transition-colors ${
              docType === d.id ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
            }`}
          >
            {t(d.label)}
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="eyebrow">{t("Document number (optional)")}</span>
        <input
          value={docNumber}
          onChange={(e) => setDocNumber(e.target.value)}
          className="tnum mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <div className="mt-4 border-t hairline pt-4">
        <IdCapture onChange={setIds} />
      </div>

      {error && <p className="mt-4 text-[13px] text-[var(--color-down)]">{error}</p>}

      <button
        onClick={() => void submit()}
        disabled={busy || !ids.doc || !ids.selfie}
        className="mt-5 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] disabled:opacity-40"
      >
        {t(busy ? "Submitting…" : "Submit for verification")}
      </button>

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        Your document and photo are stored to verify this account and are visible only to
        CAPX staff reviewing it. They are not shared with other customers or used for
        anything else.
      </p>
    </div>
  );
}
