"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";

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

/** Phone photos run large; the server refuses above 6MB, so shrink before sending. */
async function shrink(file: Blob, maxEdge = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  // 0.85 keeps a document's small print readable; lower starts to blur digits.
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function KycFlow({ onDone }: { onDone?: () => void }) {
  const { account, refresh } = useCapimonAccount();
  const [docType, setDocType] = useState<string>("nida");
  const [docNumber, setDocNumber] = useState("");
  const [doc, setDoc] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<"idle" | "live" | "denied">("idle");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera("idle");
  }, []);

  // A camera left running after the step is done is a light on someone's phone
  // with nothing on screen explaining it.
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } }, audio: false,
      });
      streamRef.current = stream;
      setCamera("live");
      // The element only exists once the state has rendered it.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCamera("denied");
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d")!;
    // Mirrored, so the saved photo matches what the person was looking at.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    setSelfie(canvas.toDataURL("image/jpeg", 0.85));
    stopCamera();
  };

  const pickDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setDoc(await shrink(file));
    } catch {
      setError("That file could not be read as an image.");
    }
  };

  const submit = async () => {
    if (!doc || !selfie) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/account/kyc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docType, docNumber: docNumber.trim() || null, doc, selfie }),
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
        <div className="eyebrow">Submitted</div>
        <h2 className="display mt-2 text-2xl">Thanks. We&rsquo;ll take a look.</h2>
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
      <h2 className="display mt-1.5 text-xl">Your document.</h2>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DOCS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDocType(d.id)}
            className={`rounded-xl border px-3 py-2.5 text-[12px] font-medium transition-colors ${
              docType === d.id ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="eyebrow">Document number (optional)</span>
        <input
          value={docNumber}
          onChange={(e) => setDocNumber(e.target.value)}
          className="tnum mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <div className="mt-3">
        {doc ? (
          <div className="flex items-center gap-3 rounded-2xl border hairline p-3">
            {/* A preview, not a gallery: enough to see the right page was photographed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={doc} alt="" className="h-16 w-24 rounded-lg object-cover" />
            <span className="flex-1 text-[13px] text-[var(--muted)]">Document attached.</span>
            <button onClick={() => setDoc(null)} className="text-[12px] underline underline-offset-2">
              Replace
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed hairline px-4 py-7 text-center text-[13px] text-[var(--muted)] transition-colors hover:surface">
            <input type="file" accept="image/*" capture="environment" onChange={pickDoc} className="hidden" />
            Photograph or upload your document
          </label>
        )}
      </div>

      <div className="mt-6 border-t hairline pt-5">
        <div className="eyebrow">Step 2 of 2</div>
        <h2 className="display mt-1.5 text-xl">A photo of you, now.</h2>

        <div className="mt-3">
          {selfie ? (
            <div className="flex items-center gap-3 rounded-2xl border hairline p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selfie} alt="" className="h-16 w-16 rounded-full object-cover" />
              <span className="flex-1 text-[13px] text-[var(--muted)]">Photo taken.</span>
              <button
                onClick={() => { setSelfie(null); void startCamera(); }}
                className="text-[12px] underline underline-offset-2"
              >
                Retake
              </button>
            </div>
          ) : camera === "live" ? (
            <div>
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-[4/3] w-full rounded-2xl bg-black object-cover [transform:scaleX(-1)]"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={capture}
                  className="flex-1 rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)]"
                >
                  Take photo
                </button>
                <button onClick={stopCamera} className="rounded-full border hairline px-5 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed hairline px-4 py-7 text-center">
              <button
                onClick={() => void startCamera()}
                className="rounded-full border hairline px-5 py-2.5 text-[13px] font-medium transition-colors hover:surface"
              >
                Open camera
              </button>
              <p className="mt-2 text-[12px] text-[var(--muted)]">
                {camera === "denied"
                  ? "Camera access was refused. Allow it in your browser settings and try again."
                  : "Taken here rather than uploaded, so it matches the document."}
              </p>
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-4 text-[13px] text-[var(--color-down)]">{error}</p>}

      <button
        onClick={() => void submit()}
        disabled={busy || !doc || !selfie}
        className="mt-5 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] disabled:opacity-40"
      >
        {busy ? "Submitting…" : "Submit for verification"}
      </button>

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        Your document and photo are stored to verify this account and are visible only to
        CAPX staff reviewing it. They are not shared with other customers or used for
        anything else.
      </p>
    </div>
  );
}
