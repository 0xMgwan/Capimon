import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { viewerOf, ACTOR, canWrite } from "@/lib/adminAuth";
import { overview, register, blotter, custodyTrail, moneyTrail, accessTrail } from "@/lib/dseOversight";
import { anchors } from "@/lib/dseAnchor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The exchange's view of its own book on CAPX.
 *
 * One route with sections rather than six routes, because the portal loads
 * them together and six round trips to the same database to draw one page is
 * six chances for half of it to arrive.
 *
 * No section here names a US security or a dollar balance. That is enforced
 * in lib/dseOversight, not here — see the note at the top of that file on why
 * the boundary lives in the queries.
 */
export async function GET(req: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  }
  const role = viewerOf(req);
  if (!role) {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }

  try {
    const [head, people, orders, custody, money, trail, anchored] = await Promise.all([
      overview(),
      register(),
      blotter(),
      custodyTrail(),
      moneyTrail(),
      accessTrail(),
      /* Each one re-derived from the live rows as it is read, which is the
         only version of this check worth running. */
      anchors(),
    ]);

    return NextResponse.json({
      ok: true,
      actor: ACTOR[role],
      /* Said in the payload rather than assumed by the page: a portal that
         shows controls the token cannot use is a portal that teaches people
         their access is broken. */
      readOnly: !canWrite(role),
      overview: head,
      register: people,
      orders,
      custody,
      money,
      anchors: anchored,
      access: trail,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "could not load the book" },
      { status: 500 });
  }
}

/**
 * There is no write path, and the refusal says which of the two reasons it is.
 *
 * An oversight token is refused because of what it is; an operating token is
 * refused because this route has nothing to change. Either way nothing here
 * mutates, and a reader of this file should not have to check.
 */
export async function POST(req: Request) {
  const role = viewerOf(req);
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  return NextResponse.json({
    ok: false, code: "read_only",
    error: `${ACTOR[role]} reads this book and does not change it. `
         + `Changes are made at CAPX and appear here once they are.`,
  }, { status: 405 });
}
