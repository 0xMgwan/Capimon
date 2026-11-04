import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Verifies a customer — by CAPX's review, or on the partner's own attestation.
 *
 * Which of the two depends on a flag CAPX sets per partner, and the
 * distinction is the whole design.
 *
 * **Without reliance** the filing is exactly that: documents go into CAPX's
 * review queue, the account stays `pending`, and nothing the caller sends can
 * set it otherwise. That is the right default, because an API that lets any
 * caller mark its own customers verified is a KYC process in name only, and
 * anybody can fill in the registration form.
 *
 * **With reliance**, CAPX has examined that partner's own onboarding and
 * agreed to accept it — a normal arrangement with a regulated counterparty
 * who has already identified the same person. The customer is approved on
 * submission and can trade immediately.
 *
 * What does not change is who is answerable. CAPX holds the assets, so every
 * attestation is written down with the partner's name, the document they say
 * they checked and the moment they said it, and the desk can revoke any of it.
 * Reliance moves the work, not the responsibility.
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

    const relied = caller.partner.kycReliance;

    /*
     * Images are required when CAPX is the one reviewing, because a review
     * needs something to look at — an earlier draft filed submissions without
     * them, which would have left customers pending forever with nothing in
     * anybody's queue.
     *
     * Under reliance the partner has already looked, so they are optional.
     * They are still stored when sent, and a partner who can send them should:
     * the day a regulator asks CAPX to evidence an identification, having the
     * document is the difference between answering and asking the partner to.
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
    if (!relied && (!doc || !selfie)) {
      return sendFail(fail("images_required",
        "Send `document_image` and `selfie_image` as base64 (a data: URL is fine). " +
        "CAPX reviews the documents themselves, so a filing without them cannot be reviewed."));
    }

    await migrate();
    const sql = db();

    /*
     * Who this account already was, before the partner said anything.
     *
     * It matters in two ways that an unconditional update got wrong.
     *
     * A customer CAPX itself verified must not have that provenance
     * rewritten: a partner attesting afterwards would erase the record that a
     * person here read the documents, which is precisely the record a
     * regulator asks for. An existing approval stands and keeps its source.
     *
     * And an account that predates the partner has details the partner did
     * not supply. Writing nida_number from this filing nulled a NIDA already
     * on file whenever the partner sent anything else — data loss on somebody
     * else's account, caused by a form they did not fill in.
     */
    const [before] = await sql<{ kyc_status: string; kyc_source: string | null;
                                 introduced: boolean }[]>`
      select kyc_status, kyc_source,
             (partner_id = ${caller.partner.id}::uuid) as introduced
        from capx.users where id = ${customer.id}::uuid`;

    const alreadyCapx = before?.kyc_status === "approved" && before?.kyc_source === "capx";
    const preExisting = before ? !before.introduced : false;
    const nida = docType === "nida" ? docNumber : null;

    await sql`
      update capx.users
         set kyc_status = ${relied ? "approved" : sql`case when kyc_status = 'approved'
                                                           then 'approved' else 'pending' end`},
             name = coalesce(nullif(${fullName}, ''), name),
             doc_type = ${docType},
             /* Only ever set, never cleared: a filing that is not a NIDA says
                nothing about a NIDA already held. */
             nida_number = coalesce(${nida}, nida_number),
             kyc_source = ${alreadyCapx ? sql`kyc_source` : (relied ? "partner" : "capx")},
             kyc_attested_by = ${alreadyCapx ? sql`kyc_attested_by`
                                             : (relied ? caller.partner.name : null)},
             kyc_attested_at = ${alreadyCapx ? sql`kyc_attested_at`
                                             : (relied ? sql`now()` : null)}
       where id = ${customer.id}::uuid`;

    /* Stored whenever it is sent, so the evidence exists either way. */
    if (doc && selfie) {
      await sql`
        insert into capx.kyc_submissions
          (user_id, doc_type, doc_number, doc_image, doc_mime, selfie_image, selfie_mime,
           status, reason)
        values (${customer.id}::uuid, ${docType}, ${docNumber}, ${doc.bytes}, ${doc.mime},
                ${selfie.bytes}, ${selfie.mime},
                ${relied ? "approved" : "pending"},
                ${relied
                  ? `Accepted on ${caller.partner.name}'s attestation (reliance)`
                    + (preExisting ? " — pre-existing CAPX account, reached by link" : "")
                  : `Filed via partner ${caller.partner.name}`
                    + (preExisting ? " — pre-existing CAPX account, reached by link" : "")})`;
    }

    /*
     * The desk hears about it either way, which it previously did not at all.
     * A partner's customer appearing and starting to trade without anybody at
     * CAPX being told is the thing that makes reliance feel like absence.
     */
    const { sendMail } = await import("@/lib/mail");
    void sendMail({
      subject: relied
        ? `CAPX: ${caller.partner.name} verified a customer`
        : `CAPX: ${caller.partner.name} filed a customer for verification`,
      text:
        `${fullName} (${customer.email})\n` +
        `Partner reference: ${ref}\n` +
        `Document: ${docType} ${docNumber}\n` +
        (preExisting
          ? `This is a pre-existing CAPX account the customer linked to ${caller.partner.name}, ` +
            `not one they introduced.\n`
          : "") +
        `\n` +
        (relied
          ? `Approved on ${caller.partner.name}'s own attestation, under the reliance CAPX has ` +
            `granted them. They can trade now. ${doc && selfie ? "Documents were supplied and " +
            "are stored." : "No documents were supplied — the partner holds them."}\n\n` +
            `Revoke reliance or suspend the customer from the partners desk if this looks wrong.`
          : `Waiting for CAPX to review. They cannot buy until it is approved.`),
    }).catch(() => {});

    const { emit } = await import("@/lib/partners");
    void emit(caller.partner.id, relied ? "customer.verified" : "customer.kyc_filed", {
      user_id: customer.id, reference: ref, kyc_status: relied ? "approved" : "pending",
    }).catch(() => {});

    return send({
      ok: true,
      user_id: customer.id,
      kyc_status: relied ? "approved" : "pending",
      source: alreadyCapx ? "capx" : (relied ? "partner" : "capx"),
      /* True when CAPX had already verified them, so your attestation was
         recorded but did not replace the existing one. */
      already_verified_by_capx: alreadyCapx,
      note: relied
        ? "Accepted on your attestation. This customer can buy now."
        : "Filed for review. Buying stays blocked until CAPX approves it.",
    }, relied ? 200 : 202);
  });
