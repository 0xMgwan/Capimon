import { NextResponse } from "next/server";
import { BY_SYMBOL } from "@/lib/assets";
import { b20Abi } from "@/lib/abis";
import { publicClient } from "@/lib/chain";

export const dynamic = "force-dynamic";

/** Decodes the B20 contractURI (ERC-7572) so the UI can show the issuer's own artwork. */
export async function GET(req: Request) {
  const asset = BY_SYMBOL[(new URL(req.url).searchParams.get("symbol") ?? "").toLowerCase()];
  if (!asset) return NextResponse.json({ ok: false, error: "unknown asset" }, { status: 404 });

  try {
    const uri = await publicClient.readContract({ address: asset.token, abi: b20Abi, functionName: "contractURI" });
    const b64 = uri.split("base64,")[1];
    const meta = b64 ? JSON.parse(Buffer.from(b64, "base64").toString("utf8")) : {};
    return NextResponse.json(
      { ok: true, symbol: asset.symbol, contractURI: uri, ...meta },
      { headers: { "cache-control": "public, max-age=3600, s-maxage=86400" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "rpc error" }, { status: 502 });
  }
}
