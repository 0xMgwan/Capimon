import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { dbConfigured } from "@/lib/db";
import { listKyc, reviewKyc } from "@/lib/kyc";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

function authorised(req: Request) {
  if (!ADMIN_TOKEN) return false;
  const url = new URL(req.url);
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
    || url.searchParams.get("token") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Submissions awaiting review, then the rest. Images are fetched separately. */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
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
  if (!authorised(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const result = await reviewKyc({
      id: String(body.id ?? ""),
      approve: body.approve === true,
      reason: body.reason ? String(body.reason).slice(0, 500) : null,
      reviewer: String(body.reviewer ?? "admin"),
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
