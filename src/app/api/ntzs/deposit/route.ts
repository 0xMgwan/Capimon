import { NextResponse } from "next/server";
import { createDeposit, getDeposit, NtzsError, ntzsConfigured } from "@/lib/ntzs";

export const dynamic = "force-dynamic";

const MIN_TZS = 500;

function fail(e: unknown) {
  const err = e instanceof NtzsError ? e : null;
  return NextResponse.json(
    { ok: false, code: err?.code ?? "ntzs_error", error: err?.message ?? "Deposit failed", retry: err?.retry },
    { status: err?.status ?? 502 },
  );
}

/**
 * Starts a mobile money collection. The payer gets a prompt on their phone, so
 * a 201 means "submitted", not "paid" — the caller polls until terminal.
 */
export async function POST(req: Request) {
  if (!ntzsConfigured) {
    return NextResponse.json({ ok: false, code: "not_configured", error: "nTZS is not configured" }, { status: 503 });
  }
  try {
    const body = await req.json();
    const userId = String(body.userId ?? "");
    const phoneNumber = String(body.phoneNumber ?? "").replace(/[^\d]/g, "");
    const amountTzs = Math.round(Number(body.amountTzs));

    if (!userId) return NextResponse.json({ ok: false, error: "userId required" }, { status: 400 });
    if (!phoneNumber) return NextResponse.json({ ok: false, error: "a mobile money number is required" }, { status: 400 });
    if (!Number.isFinite(amountTzs) || amountTzs < MIN_TZS) {
      return NextResponse.json({ ok: false, error: `Minimum deposit is ${MIN_TZS} TZS` }, { status: 400 });
    }

    const deposit = await createDeposit({ userId, amountTzs, phoneNumber });
    return NextResponse.json(
      { ok: true, deposit, note: "Approve the prompt on your phone. The balance updates once it settles." },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    // On an uncertain initiation the collection may still have been taken, so
    // the honest answer is "check", never a silent retry.
    if (e instanceof NtzsError && e.retry === "verify") {
      return NextResponse.json(
        { ok: false, code: e.code, error: e.message, retry: "verify",
          note: "The collection may still have been taken. Check your balance before trying again." },
        { status: e.status },
      );
    }
    return fail(e);
  }
}

/** Poll a deposit until its status is terminal. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, deposit: await getDeposit(id) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
