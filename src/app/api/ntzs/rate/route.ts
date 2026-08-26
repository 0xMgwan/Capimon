import { NextResponse } from "next/server";
import { getSwapRate, NtzsError, ntzsConfigured, ntzsLiveMode } from "@/lib/ntzs";

export const dynamic = "force-dynamic";

/** Live TZS/USDC rate. Public upstream, so this works with no key configured. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const from = u.searchParams.get("from") === "USDC" ? "USDC" : "NTZS";
  const to = from === "NTZS" ? "USDC" : "NTZS";
  const amount = Number(u.searchParams.get("amount") ?? (from === "NTZS" ? 100_000 : 50));
  if (!(amount > 0)) return NextResponse.json({ ok: false, error: "amount must be > 0" }, { status: 400 });

  try {
    const rate = await getSwapRate(from, to, amount);
    return NextResponse.json(
      { ok: true, from, to, amount, configured: ntzsConfigured, liveMode: ntzsLiveMode, ...rate },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const err = e instanceof NtzsError ? e : null;
    return NextResponse.json(
      {
        ok: false,
        code: err?.code ?? "rate_unavailable",
        error: err?.message ?? "Could not fetch the nTZS rate",
        configured: ntzsConfigured,
      },
      { status: err?.status ?? 502 },
    );
  }
}
