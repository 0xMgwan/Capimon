import { NextResponse } from "next/server";
import { db, migrate } from "@/lib/db";
import { hashPassword, passwordProblem, createSession } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { upsertUser, ntzsConfigured, NtzsError } from "@/lib/ntzs";

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

    if (!email.includes("@") || email.length < 5) return bad("Enter a valid email address.");
    const pwProblem = passwordProblem(password);
    if (pwProblem) return bad(pwProblem, "weak_password");

    await migrate();
    const sql = db();

    const existing = await sql<{ id: string }[]>`select id from capx.users where email = ${email} limit 1`;
    if (existing.length) return bad("An account already exists for that email.", "email_taken", 409);

    const rows = await sql<{ id: string }[]>`
      insert into capx.users (email, password_hash, name, phone)
      values (${email}, ${await hashPassword(password)}, ${name}, ${phone})
      returning id`;
    const userId = rows[0].id;

    // Provision the nTZS side now where possible; identity can follow.
    let ntzsUserId: string | null = null;
    let ntzsNote: string | null = null;
    if (ntzsConfigured) {
      try {
        const u = await upsertUser({ externalId: userId, email, name: name ?? undefined });
        ntzsUserId = u.id;
        await sql`update capx.users set ntzs_user_id = ${ntzsUserId} where id = ${userId}`;
      } catch (e) {
        // A missing identity is expected at this stage, not a failure to register.
        ntzsNote = e instanceof NtzsError ? e.message : "nTZS account will be created when you fund.";
      }
    }

    await createSession(userId);
    return NextResponse.json({ ok: true, user: { id: userId, email, name, phone }, ntzsUserId, ntzsNote });
  } catch (e) {
    return boom(e, "Could not create your account");
  }
}
