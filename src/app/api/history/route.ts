import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getWalletHistory } from "@/lib/history";

export const dynamic = "force-dynamic";

/** Rebuilding a wallet's history is log-heavy, so results are cached per address. */
const TTL_MS = 120_000;
const cache = new Map<string, { at: number; data: Awaited<ReturnType<typeof getWalletHistory>> }>();

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return NextResponse.json({ ok: false, error: "bad address" }, { status: 400 });

  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, ...hit.data }, { headers: { "cache-control": "no-store" } });
  }

  try {
    const data = await getWalletHistory(address as `0x${string}`);
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json({ ok: true, ...data }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (hit) {
      return NextResponse.json({ ok: true, stale: true, ...hit.data }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "could not rebuild history" },
      { status: 502 },
    );
  }
}
