import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Files a customer's verification for CAPX to review.
 *
 * It does not approve anybody. A partner can assert that they have checked
 * their customer, and that assertion is recorded with their name on it, but
 * the account stays `pending` until CAPX reviews it — buying is gated on
 * `approved` and nothing a partner sends can set that.
 *
 * The reason is simple: the obligation is CAPX's, and an API that let a
 * caller mark its own customers verified would be a KYC process in name only.
 */
export const POST = partnerRoute("POST /v1/users/:ref/kyc", { idempotent: true },
  async ({ caller, body, req }) => {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const ref = decodeURIComponent(parts[parts.length - 2] ?? "");
    const customer = await partnerCustomer(caller.partner.id, ref);
    if (!customer) {
      return sendFail(fail("unknown_customer", "No customer of yours matches that.", 404));
    }

    const docType = String(body.document_type ?? "").trim().toLowerCase();
    const docNumber = String(body.document_number ?? "").trim();
    const fullName = String(body.full_name ?? "").trim();
    if (!docType || !docNumber || !fullName) {
      return sendFail(fail("incomplete",
        "`full_name`, `document_type` and `document_number` are all required."));
    }

    /*
     * The images are required, because a review needs something to look at.
     *
     * An earlier draft filed a submission without them and relied on the
     * insert failing quietly, which would have left a customer marked pending
     * forever with nothing in the queue for anybody to approve. If a partner
     * cannot send the document and the selfie, they cannot file the
     * verification, and saying so is better than accepting it and losing it.
     */
    const decode = (v: unknown): { bytes: Buffer; mime: string } | null => {
      const raw = typeof v === "string" ? v.trim() : "";
      if (!raw) return null;
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(raw);
      const mime = m ? m[1] : "image/jpeg";
      const b64 = m ? m[2] : raw;
      try {
        const bytes = Buffer.from(b64, "base64");
        return bytes.length > 256 ? { bytes, mime } : null;
      } catch { return null; }
    };

    const doc = decode(body.document_image);
    const selfie = decode(body.selfie_image);
    if (!doc || !selfie) {
      return sendFail(fail("images_required",
        "Send `document_image` and `selfie_image` as base64 (a data: URL is fine). " +
        "CAPX reviews the documents themselves, so a filing without them cannot be reviewed."));
    }

    await migrate();
    const sql = db();
    await sql`
      update capx.users
         set kyc_status = case when kyc_status = 'approved' then 'approved' else 'pending' end,
             name = coalesce(nullif(${fullName}, ''), name),
             doc_type = ${docType},
             nida_number = ${docType === "nida" ? docNumber : null}
       where id = ${customer.id}::uuid`;

    await sql`
      insert into capx.kyc_submissions
        (user_id, doc_type, doc_number, doc_image, doc_mime, selfie_image, selfie_mime, status, reason)
      values (${customer.id}::uuid, ${docType}, ${docNumber}, ${doc.bytes}, ${doc.mime},
              ${selfie.bytes}, ${selfie.mime}, 'pending',
              ${`Filed via partner ${caller.partner.name}`})`;

    return send({ ok: true, user_id: customer.id, kyc_status: "pending",
      note: "Filed for review. Buying stays blocked until CAPX approves it." }, 202);
  });
