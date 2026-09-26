import { NextResponse } from "next/server";
import { requireDb } from "@/lib/apiHelpers";
import { publicProfile } from "@/lib/social";

export const dynamic = "force-dynamic";

/**
 * A customer as other customers may see them.
 *
 * The handle and the name are always here; everything about money is behind
 * that account's own switch, and the check lives in the query rather than in
 * this handler.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const gate = requireDb();
  if (gate) return gate;
  const { username } = await params;
  const profile = await publicProfile(username);
  if (!profile) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, profile }, { headers: { "cache-control": "no-store" } });
}
