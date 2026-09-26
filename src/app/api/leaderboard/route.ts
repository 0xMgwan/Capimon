import { NextResponse } from "next/server";
import { requireDb } from "@/lib/apiHelpers";
import { leaderboard } from "@/lib/social";
import { publicCache } from "@/lib/httpCache";

export const dynamic = "force-dynamic";

/** Only accounts that have published their trading appear at all. */
export async function GET(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  const by = new URL(req.url).searchParams.get("by") === "realised" ? "realised" : "volume";
  return NextResponse.json({ ok: true, by, rows: await leaderboard(by) },
    { headers: publicCache(60) });
}
