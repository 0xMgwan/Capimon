import { NextResponse } from "next/server";
import { db, dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * A registered security's logo, served as an image.
 *
 * Public on purpose: it is the company's mark, shown wherever the security is.
 * Served by URL rather than inlined into every listing, so pages that show
 * many securities fetch each logo once and cache it.
 */
export async function GET(req: Request) {
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!dbConfigured || !/^[A-Z0-9.]{1,16}$/.test(symbol)) return new NextResponse("not found", { status: 404 });

  const rows = await db()<{ logo: string | null }[]>`
    select metadata->>'logo' as logo from capx.securities where symbol = ${symbol}`.catch(() => []);
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(rows[0]?.logo ?? "");
  if (!m) return new NextResponse("not found", { status: 404 });

  return new NextResponse(new Uint8Array(Buffer.from(m[2], "base64")), {
    headers: { "content-type": m[1], "cache-control": "public, max-age=3600" },
  });
}
