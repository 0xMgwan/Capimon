"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * The two photographs an identity check needs: a document, and a face.
 *
 * Lifted out of the verification page so the signup form can use the same
 * controls. Duplicating them would mean two camera implementations, two sets of
 * permission handling and two places for the HEIC problem to be fixed in one of
 * them.
 *
 * It owns the capture and reports the result upward rather than taking a dozen
 * props, because the parent only cares about the two data URLs and whether the
 * document happens to be a PDF.
 */

export type Captured = { doc: string | null; selfie: string | null; docKind: "image" | "pdf" };

/** The server refuses above this, so a file is checked before it is sent. */
const MAX_BYTES = 6 * 1024 * 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("unreadable"));
    r.readAsDataURL(file);
  });
}

/** Phone photos run large; shrink to get under the limit before sending. */
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

export function IdCapture({ onChange, compact }: {
  onChange: (c: Captured) => void;
  /** Tighter spacing when this sits inside a longer form. */
  compact?: boolean;
}) {
  const { t } = useT();
  const [doc, setDoc] = useState<string | null>(null);
  const [docKind, setDocKind] = useState<"image" | "pdf">("image");
  const [docName, setDocName] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<"idle" | "live" | "denied">("idle");

  useEffect(() => { onChange({ doc, selfie, docKind }); }, [doc, selfie, docKind, onChange]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
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
      if (file.type === "application/pdf") {
        if (file.size > MAX_BYTES) { setError(t("That file is too large. The limit is 6MB.")); return; }
        setDocKind("pdf"); setDocName(file.name); setDoc(await readAsDataUrl(file));
        return;
      }
      setDocKind("image"); setDocName(file.name); setDoc(await shrink(file));
    } catch {
      // HEIC from an iPhone is the usual cause: some browsers cannot decode it
      // to a canvas. Saying which formats work is more use than saying no.
      setError(t("That file could not be read. Try a JPEG, PNG or PDF."));
    }
  };

  return (
    <div className={compact ? "grid gap-2.5" : "grid gap-4"}>
      <div>
        <span className="eyebrow">{t("Your document")}</span>
        <div className="mt-1.5">
          {doc ? (
            <div className="flex items-center gap-3 rounded-2xl border hairline p-3">
              {docKind === "pdf" ? (
                <span className="grid h-14 w-20 shrink-0 place-items-center rounded-lg surface text-[11px] font-medium text-[var(--muted)]">
                  PDF
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={doc} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
              )}
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--muted)]">
                {docName || t("Document attached.")}
              </span>
              <button onClick={() => setDoc(null)} className="shrink-0 text-[12px] underline underline-offset-2">
                {t("Replace")}
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed hairline px-4 py-6 text-center text-[13px] text-[var(--muted)] transition-colors hover:surface">
              {/* No `capture` attribute: it tells the browser to prefer the
                  camera, which on a phone hides Files entirely. */}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                onChange={pickDoc}
                className="hidden"
              />
              {t("Photograph or upload your document (JPEG, PNG or PDF)")}
            </label>
          )}
        </div>
      </div>

      <div>
        <span className="eyebrow">{t("A photo of you, now")}</span>
        <div className="mt-1.5">
          {selfie ? (
            <div className="flex items-center gap-3 rounded-2xl border hairline p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selfie} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
              <span className="flex-1 text-[13px] text-[var(--muted)]">{t("Photo taken.")}</span>
              <button
                onClick={() => { setSelfie(null); void startCamera(); }}
                className="shrink-0 text-[12px] underline underline-offset-2"
              >
                {t("Retake")}
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
                  className="flex-1 rounded-full bg-[var(--fg)] py-2.5 text-sm font-medium text-[var(--bg)]"
                >
                  {t("Take photo")}
                </button>
                <button onClick={stopCamera} className="rounded-full border hairline px-4 text-sm">
                  {t("Cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed hairline px-4 py-6 text-center">
              <button
                onClick={() => void startCamera()}
                className="rounded-full border hairline px-5 py-2 text-[13px] font-medium transition-colors hover:surface"
              >
                {t("Open camera")}
              </button>
              <p className="mt-2 text-[12px] text-[var(--muted)]">
                {camera === "denied"
                  ? t("Camera access was refused. Allow it in your browser settings and try again.")
                  : t("Taken here rather than uploaded, so it matches the document.")}
              </p>
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-[13px] text-[var(--color-down)]">{error}</p>}
    </div>
  );
}
