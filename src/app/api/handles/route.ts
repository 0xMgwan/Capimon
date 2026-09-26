import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb } from "@/lib/apiHelpers";
import { searchHandles } from "@/lib/social";

export const dynamic = "force-dynamic";

/**
 * Handles for the @ autocomplete.
 *
 * Signed in only. A username is a public name once it appears on a comment,
 * but a list of every customer's handle is a customer list, and that is not
 * something to hand to anybody who asks.
 */
export async function GET(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: true, handles: [] });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ ok: true, handles: await searchHandles(q) },
    { headers: { "cache-control": "no-store" } });
}
