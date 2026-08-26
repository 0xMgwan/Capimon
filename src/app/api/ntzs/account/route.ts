import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { upsertUser, getUser, NtzsError, ntzsConfigured, ntzsLiveMode } from "@/lib/ntzs";

export const dynamic = "force-dynamic";

function fail(e: unknown) {
  const err = e instanceof NtzsError ? e : null;
  return NextResponse.json(
    { ok: false, code: err?.code ?? "ntzs_error", error: err?.message ?? "nTZS request failed", retry: err?.retry },
    { status: err?.status ?? 502 },
  );
}

/**
 * Creates or recovers the caller's nTZS account. `externalId` is the user's own
 * wallet address, and the upstream is idempotent on it — so this doubles as
 * sign-in, and CAPIMON needs no user database of its own.
 */
export async function POST(req: Request) {
  if (!ntzsConfigured) {
    return NextResponse.json(
      { ok: false, code: "not_configured", error: "nTZS is not configured on this deployment" },
      { status: 503 },
    );
  }
  try {
    const body = await req.json();
    const address = String(body.address ?? "");
    const email = String(body.email ?? "").trim();
    if (!isAddress(address)) return NextResponse.json({ ok: false, error: "a wallet address is required" }, { status: 400 });
    if (!email.includes("@")) return NextResponse.json({ ok: false, error: "a valid email is required" }, { status: 400 });

    const country = String(body.country ?? "TZ").toUpperCase();
    const phone = body.phone ? String(body.phone).replace(/[^\d]/g, "") : undefined;
    const nidaNumber = body.nidaNumber ? String(body.nidaNumber).replace(/[^\d]/g, "") : undefined;

    // No wallet is issued without a verified identity, so fail early and
    // clearly rather than letting the upstream 400 surface as a mystery.
    if (country === "TZ" && (!phone || !nidaNumber)) {
      return NextResponse.json(
        { ok: false, code: "kyc_required", error: "A NIDA number and your own mobile money number are required to open a Tanzanian nTZS account." },
        { status: 400 },
      );
    }
    if (nidaNumber && nidaNumber.length !== 20) {
      return NextResponse.json({ ok: false, code: "kyc_required", error: "A NIDA number is 20 digits." }, { status: 400 });
    }

    const user = await upsertUser({
      externalId: address.toLowerCase(),
      email,
      name: body.name ? String(body.name) : undefined,
      phone, nidaNumber, country,
    });

    return NextResponse.json(
      { ok: true, liveMode: ntzsLiveMode, user },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}

/** Live nTZS and USDC balances, read from Base at request time. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("userId") ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "userId required" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, user: await getUser(id) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
