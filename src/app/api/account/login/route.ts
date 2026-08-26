import { NextResponse } from "next/server";
import { db, migrate } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) return bad("Email and password are required.");

    await migrate();
    const rows = await db()<{ id: string; password_hash: string }[]>`
      select id, password_hash from users where email = ${email} limit 1`;

    // Same answer whether the email exists or the password is wrong, so this
    // cannot be used to enumerate accounts.
    const ok = rows.length ? await verifyPassword(password, rows[0].password_hash) : false;
    if (!ok) return bad("Email or password is incorrect.", "invalid_credentials", 401);

    await createSession(rows[0].id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return boom(e, "Could not sign you in");
  }
}
