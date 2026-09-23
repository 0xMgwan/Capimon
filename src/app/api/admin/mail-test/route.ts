import { NextResponse } from "next/server";
import { roleOf } from "@/lib/adminAuth";
import { sendMail, mailConfigured, opsEmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

/**
 * Checks that outbound mail actually works, from the deployment that has to
 * send it.
 *
 * KYC notices and verification emails are sent from a background task after a
 * response has gone out, which is exactly where a wrong password or a blocked
 * port fails silently: the customer's submission succeeds, and nobody learns
 * the notice never arrived. This is the one place the send is in the
 * foreground and the error comes back to a person who can fix it.
 *
 * CAPX only. A route that sends mail on request is a relay if it is left
 * open, and FIMCO has no reason to reach it.
 */
export async function GET(req: Request) {
  if (roleOf(req) !== "admin") {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    configured: mailConfigured,
    // The address, not the password: enough to tell whether the right account
    // is wired up, and nothing that would matter if this were ever logged.
    user: process.env.SMTP_USER ?? null,
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    ops: opsEmail,
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (roleOf(req) !== "admin") {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }
  if (!mailConfigured) {
    return NextResponse.json(
      { ok: false, error: "Mail is not configured. Set SMTP_USER and SMTP_PASS." },
      { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  // Defaults to the operations address, which is the test that matters most:
  // it is where every KYC request is meant to land.
  const to = String(body.to ?? "").trim() || opsEmail;
  if (!to.includes("@")) return NextResponse.json({ ok: false, error: "Enter an email address." }, { status: 400 });

  const at = new Date().toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" });
  const r = await sendMail({
    to,
    subject: "CAPX — mail test",
    text: [
      "This is a test from the CAPX operations desk.",
      "",
      "If you are reading it, outbound mail works: KYC requests will reach the",
      "operations address and customers will be told when they are verified.",
      "",
      `Sent ${at} EAT.`,
    ].join("\n"),
  });

  return NextResponse.json(
    r.sent ? { ok: true, to } : { ok: false, to, error: r.reason ?? "Could not send" },
    { status: r.sent ? 200 : 502, headers: { "cache-control": "no-store" } });
}
