import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { convertUsdcToTzs } from "@/lib/convert";

export const dynamic = "force-dynamic";

/**
 * The HTTP side of turning dollars back into shillings.
 *
 * The conversion itself lives in lib/convert.ts so that a partner doing it
 * for their own customer runs the identical path. What is left here is
 * reading the request and handing back the answer.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const result = await convertUsdcToTzs(user.id, {
      amountUsdc: Number(body.amountUsdc), all: body.all === true,
    });

    if (!result.ok) {
      const { status, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.message && e.message.length < 300) {
      return bad(e.message, "convert_failed");
    }
    return boom(e, "Could not convert your balance");
  }
}
