import "server-only";
import { db, migrate } from "./db";

/**
 * Identity checks: what a customer submitted, and what was decided about it.
 *
 * Two things are kept apart on purpose. `kyc_submissions` is the evidence and
 * the decision trail; `users.kyc_status` is the single answer the rest of the
 * app reads. Code that needs to know whether someone may trade should never be
 * joining across submissions to work it out, and the evidence should never be
 * loaded to answer a yes-or-no question.
 */

export type KycStatus = "none" | "pending" | "approved" | "rejected";

export type KycSubmission = {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  doc_type: string;
  doc_number: string | null;
  status: KycStatus;
  reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  /** Bytes, so a list can show sizes without carrying the images. */
  doc_bytes: number;
  selfie_bytes: number;
  /**
   * Addresses this applicant has proved they control.
   *
   * A reviewer deciding whether to verify somebody who will hold securities
   * in their own wallet should be able to see which wallet, without going to
   * another screen to find out. Null where there is none, which is the usual
   * case for a custodial customer.
   */
  wallets: string[] | null;
  /** A reviewer needs to know whether the document is a picture or a PDF. */
  doc_mime: string;
};

/** Accepted photographs. */
const IMAGE_MIME = /^image\/(jpeg|png|webp|heic|heif)$/i;
/**
 * A document may also be a PDF, because an ID scan usually is one.
 *
 * Only the document. A selfie has to be a photograph taken now, and accepting a
 * PDF there would let someone attach a scan of a photograph of somebody else,
 * which is the exact thing the selfie step is for.
 */
const DOC_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i;
/** Per image. Phone cameras produce two to five megabytes; this leaves room. */
const MAX_BYTES = 6 * 1024 * 1024;

/**
 * Turns a data URL into bytes, refusing anything that is not a plausible photo.
 *
 * The checks are on the decoded bytes rather than the string, because a base64
 * length tells you very little and the point is to bound what actually reaches
 * the database.
 */
export function decodeImage(
  dataUrl: unknown,
  label: string,
  opts: { allowPdf?: boolean } = {},
): { bytes: Buffer; mime: string } {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw new Error(`${label} is missing.`);
  }
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error(`${label} is not a readable file.`);

  const [, mime, b64] = match;
  const allowed = opts.allowPdf ? DOC_MIME : IMAGE_MIME;
  if (!allowed.test(mime)) {
    throw new Error(
      opts.allowPdf
        ? `${label} must be a photo or a PDF.`
        : `${label} must be a photo (JPEG, PNG, WebP or HEIC).`,
    );
  }
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length < 1024) throw new Error(`${label} is too small to be a real file.`);
  if (bytes.length > MAX_BYTES) {
    throw new Error(`${label} is ${(bytes.length / 1e6).toFixed(1)}MB. The limit is 6MB.`);
  }
  return { bytes, mime: mime.toLowerCase() };
}

/** The user's own view: where their check stands, and nothing about the images. */
export async function kycFor(userId: string) {
  await migrate();
  const rows = await db()<{ status: KycStatus; reason: string | null; created_at: string }[]>`
    select status, reason, created_at
      from capx.kyc_submissions
     where user_id = ${userId}
     order by created_at desc
     limit 1`;
  return rows[0] ?? null;
}

/**
 * Files a submission.
 *
 * A new one supersedes any earlier pending attempt rather than queueing beside
 * it, so a reviewer never sees two versions of the same person and has to guess
 * which is current. A rejected submission is left as it is: it is the record of
 * why, and the reason shown to the customer points at it.
 */
export async function submitKyc(input: {
  userId: string;
  docType: string;
  docNumber?: string | null;
  doc: { bytes: Buffer; mime: string };
  selfie: { bytes: Buffer; mime: string };
}) {
  await migrate();
  const sql = db();

  await sql`
    update capx.kyc_submissions set status = 'superseded'
     where user_id = ${input.userId} and status = 'pending'`;

  const rows = await sql<{ id: string }[]>`
    insert into capx.kyc_submissions
      (user_id, doc_type, doc_number, doc_image, doc_mime, selfie_image, selfie_mime, status)
    values (${input.userId}, ${input.docType}, ${input.docNumber ?? null},
            ${input.doc.bytes}, ${input.doc.mime},
            ${input.selfie.bytes}, ${input.selfie.mime}, 'pending')
    returning id::text`;

  await sql`update capx.users set kyc_status = 'pending' where id = ${input.userId}`;
  return rows[0].id;
}

/** Everything a reviewer needs except the images themselves. */
export async function listKyc(limit = 50): Promise<KycSubmission[]> {
  await migrate();
  return db()<KycSubmission[]>`
    select k.id::text, k.user_id::text, u.email, u.name,
           k.doc_type, k.doc_number, k.status, k.reason,
           k.reviewed_by, k.reviewed_at, k.created_at,
           length(k.doc_image) as doc_bytes, length(k.selfie_image) as selfie_bytes,
           k.doc_mime,
           /* Live wallet links only: a revoked one is not something this
              person currently holds, and showing it would invite a reviewer
              to approve against an address that no longer applies. */
           (select json_agg(w.address order by w.verified_at)
              from capx.wallet_links w
             where w.user_id = k.user_id
               and w.verified_at is not null and w.revoked_at is null) as wallets
      from capx.kyc_submissions k
      join capx.users u on u.id = k.user_id
     order by (k.status = 'pending') desc, k.created_at desc
     limit ${limit}`;
}

/** One image, read on its own so a listing never carries megabytes it will not show. */
export async function kycImage(id: string, which: "doc" | "selfie") {
  await migrate();
  const rows = which === "doc"
    ? await db()<{ image: Buffer; mime: string }[]>`
        select doc_image as image, doc_mime as mime from capx.kyc_submissions where id = ${id}::uuid`
    : await db()<{ image: Buffer; mime: string }[]>`
        select selfie_image as image, selfie_mime as mime from capx.kyc_submissions where id = ${id}::uuid`;
  return rows[0] ?? null;
}

/**
 * Records a decision, and moves the user's status with it.
 *
 * Both writes or neither: a submission marked approved while the user still
 * reads as unverified would block the customer with nothing on screen to
 * explain why, and the opposite would let an unchecked account trade.
 */
export async function reviewKyc(input: {
  id: string;
  approve: boolean;
  reason?: string | null;
  reviewer: string;
}) {
  await migrate();
  const sql = db();
  const status = input.approve ? "approved" : "rejected";

  if (!input.approve && !input.reason?.trim()) {
    throw new Error("A rejection needs a reason, since the customer is shown it.");
  }

  const rows = await sql<{ user_id: string }[]>`
    update capx.kyc_submissions
       set status = ${status}, reason = ${input.reason ?? null},
           reviewed_by = ${input.reviewer}, reviewed_at = now()
     where id = ${input.id}::uuid and status = 'pending'
    returning user_id::text`;

  if (!rows[0]) throw new Error("That submission is not awaiting review.");

  await sql`update capx.users set kyc_status = ${status} where id = ${rows[0].user_id}::uuid`;
  return { userId: rows[0].user_id, status };
}
