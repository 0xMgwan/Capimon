import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { listKyc, reviewKyc } from "@/lib/kyc";
import { roleOf, ACTOR } from "@/lib/adminAuth";
import { sendMail } from "@/lib/mail";
import { db } from "@/lib/db";
import { after } from "next/server";

export const dynamic = "force-dynamic";

/** Submissions awaiting review, then the rest. Images are fetched separately. */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  // FIMCO, as broker of record, holds its clients' verification for compliance.
  if (!roleOf(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, submissions: await listKyc() },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "could not load submissions" },
      { status: 500 },
    );
  }
}

/** Approves or rejects one submission, moving the customer's status with it. */
export async function POST(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  /* One party decides each customer, so a verification cannot be approved by
     one and rejected by the other. That party is CAPX. */
  const role = roleOf(req);
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  if (role !== "admin") return NextResponse.json({ ok: false, code: "forbidden", error: "Reviews are CAPX's to decide." }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const result = await reviewKyc({
      id: String(body.id ?? ""),
      approve: body.approve === true,
      reason: body.reason ? String(body.reason).slice(0, 500) : null,
      reviewer: String(body.reviewer ?? ACTOR[role]),
    });
    /*
     * Tell the customer, after the reviewer has their answer.
     *
     * A decision they are not told about is a decision they discover by
     * trying to buy and being refused. Sent with `after` so a slow mail
     * provider cannot hold up the review, and a failure is logged rather
     * than raised: the decision itself is already recorded.
     */
    after(async () => {
      const [u] = await db()<{ email: string; name: string | null }[]>`
        select email, name from capx.users where id = ${result.userId}::uuid`;
      if (!u) return;
      const approved = result.status === "approved";
      const r = await sendMail({
        to: u.email,
        subject: approved ? "Your CAPX account is verified" : "About your CAPX verification",
        text: approved
          ? [
              `Hello${u.name ? ` ${u.name.split(" ")[0]}` : ""},`,
              ``,
              `Your identity has been verified, so your CAPX account is fully open.`,
              `You can now buy shares and withdraw to your mobile money or bank.`,
              ``,
              `https://www.capx.broker/markets`,
              ``,
              `CAPX`,
            ].join("\n")
          : [
              `Hello${u.name ? ` ${u.name.split(" ")[0]}` : ""},`,
              ``,
              `We could not verify your identity from what was submitted.`,
              body.reason ? `\nReason: ${String(body.reason).slice(0, 500)}\n` : ``,
              `You can submit again, and your money stays yours in the meantime —`,
              `nothing has been taken from your account.`,
              ``,
              `https://www.capx.broker/verify`,
              ``,
              `CAPX`,
            ].join("\n"),
      });
      if (!r.sent) console.warn(`KYC decision notice to the customer not sent: ${r.reason}`);
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // A refused review is the rule working, not a fault.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "review failed" },
      { status: 409 },
    );
  }
}
