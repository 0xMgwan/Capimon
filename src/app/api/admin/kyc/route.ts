import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { listKyc, reviewKyc } from "@/lib/kyc";
import { roleOf, ACTOR } from "@/lib/adminAuth";

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
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // A refused review is the rule working, not a fault.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "review failed" },
      { status: 409 },
    );
  }
}
