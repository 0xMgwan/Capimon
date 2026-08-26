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
    // The field is one box: people type whichever they remember.
    const identifier = String(body.email ?? body.username ?? "").trim().toLowerCase().replace(/^@/, "");
    const password = String(body.password ?? "");
    if (!identifier || !password) return bad("Email or username and password are required.");

    await migrate();
    const rows = await db()<{ id: string; password_hash: string }[]>`
      select id, password_hash from capx.users
       where email = ${identifier} or lower(username) = ${identifier}
       limit 1`;

    // Same answer whether the email exists or the password is wrong, so this
    // cannot be used to enumerate accounts.
    const ok = rows.length ? await verifyPassword(password, rows[0].password_hash) : false;
    if (!ok) return bad("Those details are not correct.", "invalid_credentials", 401);

    await createSession(rows[0].id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return boom(e, "Could not sign you in");
  }
}
