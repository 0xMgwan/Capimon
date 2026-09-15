import { NextResponse } from "next/server";
import { db, migrate } from "@/lib/db";
import { hashPassword, passwordProblem, createSession } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/**
 * Opens a custodial account. KYC is deliberately not required here — identity
 * is collected when the user first funds, which is the point nTZS needs it.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;

  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = body.name ? String(body.name).trim() : null;
    const phone = body.phone ? String(body.phone).replace(/[^\d]/g, "") : null;
    /*
     * The identity document, whichever kind it is.
     *
     * Only a NIDA is twenty digits; a passport or a licence carries letters,
     * so the digits-only strip that used to run here quietly destroyed those
     * numbers before they were stored.
     */
    const DOC_TYPES = new Set(["nida", "passport", "licence", "voter"]);
    const docType = DOC_TYPES.has(String(body.docType ?? "").toLowerCase())
      ? String(body.docType).toLowerCase() : "nida";
    const rawDoc = body.nidaNumber ?? body.docNumber;
    const nida = rawDoc
      ? (docType === "nida"
          ? String(rawDoc).replace(/[^\d]/g, "")
          : String(rawDoc).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "")).slice(0, 32) || null
      : null;
    if (docType === "nida" && nida && nida.length !== 20) {
      return bad("A NIDA number is 20 digits.");
    }
    const username = body.username ? String(body.username).trim().replace(/^@/, "") : null;
    if (username && !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return bad("A username is 3–20 letters, numbers or underscores.", "bad_username");
    }

    if (!email.includes("@") || email.length < 5) return bad("Enter a valid email address.");

    /*
     * Agreement is checked here, not only in the form.
     *
     * A disabled button is a courtesy to the person using the page, not a
     * control — anything can post to this route. The timestamp is recorded
     * because the evidence that matters later is when someone agreed, and a
     * boolean on a row cannot answer that.
     */
    if (body.acceptedTerms !== true) {
      return bad("Please accept the terms of service and privacy policy.", "terms_not_accepted");
    }
    const pwProblem = passwordProblem(password);
    if (pwProblem) return bad(pwProblem, "weak_password");

    await migrate();
    const sql = db();

    const existing = await sql<{ id: string }[]>`select id from capx.users where email = ${email} limit 1`;
    if (existing.length) return bad("An account already exists for that email.", "email_taken", 409);

    if (username) {
      const taken = await sql<{ id: string }[]>`
        select id from capx.users where lower(username) = ${username.toLowerCase()} limit 1`;
      if (taken.length) return bad("That username is taken.", "username_taken", 409);
    }

    const rows = await sql<{ id: string }[]>`
      insert into capx.users (email, password_hash, name, phone, nida_number, doc_type, username, terms_accepted_at)
      values (${email}, ${await hashPassword(password)}, ${name}, ${phone}, ${nida}, ${docType}, ${username}, now())
      returning id`;
    const userId = rows[0].id;

    // No per-user nTZS wallet. Deposits collect into the CAPX omnibus account
    // and are attributed by the deposits table, which keeps the Tanzanian flow
    // to an amount and a phone prompt.
    await createSession(userId);
    return NextResponse.json({ ok: true, user: { id: userId, email, username, name, phone } });
  } catch (e) {
    return boom(e, "Could not create your account");
  }
}
