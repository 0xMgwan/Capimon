import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { listFor, createFor, updateFor, type Cadence } from "@/lib/recurring";
import { dseSecurity } from "@/lib/dseSecurities";

export const dynamic = "force-dynamic";

/** The smallest instalment worth placing: below this the fee eats it. */
const MIN_TZS = 5_000;
/** A ceiling, so a mistyped amount cannot schedule a fortune every week. */
const MAX_TZS = 10_000_000;

export async function GET() {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });
    return NextResponse.json({ ok: true, plans: await listFor(user.id) },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not load your plans");
  }
}

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    // Pause, resume and cancel come through here too; they are scoped to the
    // caller inside updateFor, so one customer cannot touch another's plan.
    const action = String(body.action ?? "");
    if (action === "pause" || action === "resume" || action === "cancel") {
      const done = await updateFor(user.id, String(body.id ?? ""), action);
      if (!done) return bad("No such plan.", "not_found", 404);
      return NextResponse.json({ ok: true, plans: await listFor(user.id) });
    }

    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const security = symbol ? await dseSecurity(symbol) : null;
    if (!security) return bad("That security is not listed on CAPX.", "unknown_security");
    if (security.status !== "live") return bad(`${symbol} is not open for trading yet.`, "not_live");

    const amountTzs = Math.round(Number(body.amountTzs));
    if (!Number.isFinite(amountTzs) || amountTzs < MIN_TZS) {
      return bad(`The smallest recurring amount is ${MIN_TZS.toLocaleString()} TZS.`);
    }
    if (amountTzs > MAX_TZS) {
      return bad(`The largest recurring amount is ${MAX_TZS.toLocaleString()} TZS.`);
    }

    const cadence: Cadence = body.cadence === "monthly" ? "monthly" : "weekly";
    // 28 is the ceiling for a monthly day so that February still has one.
    const dayOf = cadence === "weekly"
      ? Math.min(Math.max(Number(body.dayOf) || 1, 0), 6)
      : Math.min(Math.max(Number(body.dayOf) || 1, 1), 28);

    // A handful is a plan; a hundred is a mistake or an attack.
    const existing = await listFor(user.id);
    if (existing.length >= 10) return bad("You already have ten plans. Cancel one first.");

    const plan = await createFor(user.id, { symbol: security.symbol, amountTzs, cadence, dayOf });
    return NextResponse.json({ ok: true, plan, plans: await listFor(user.id) });
  } catch (e) {
    return boom(e, "Could not save your plan");
  }
}
