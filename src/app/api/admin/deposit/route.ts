import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db, migrate, dbConfigured } from "@/lib/db";
import { getDeposit } from "@/lib/ntzs";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

function authorised(req: Request) {
  if (!ADMIN_TOKEN) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * One deposit, both sides: what CAPX recorded and what nTZS says right now.
 * Fetched live rather than served from the stored snapshot, because the point
 * of reconciliation is catching the case where the two disagree.
 */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  try {
    await migrate();
    const rows = await db()`
      select d.*, u.email, u.name, u.nida_number, u.phone as account_phone
        from capx.deposits d join capx.users u on u.id = d.user_id
       where d.id = ${id} limit 1`;
    const local = rows[0];
    if (!local) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    let upstream: unknown = null;
    let upstreamError: string | null = null;
    if (local.ntzs_deposit_id) {
      try {
        upstream = await getDeposit(String(local.ntzs_deposit_id));
      } catch (e) {
        upstreamError = e instanceof Error ? e.message : "could not read nTZS";
      }
    }

    const remoteStatus = String((upstream as { status?: string } | null)?.status ?? "").toLowerCase();
    return NextResponse.json({
      ok: true, local, upstream, upstreamError,
      // The check worth surfacing: do both sides agree this settled?
      agrees: !upstream ? null
        : (local.status === "settled") === ["settled", "completed", "success", "successful", "confirmed"].includes(remoteStatus),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "lookup failed" },
      { status: 500 },
    );
  }
}
