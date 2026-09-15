import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { publishDsePrice, readOraclePrice } from "@/lib/oracle";
import { CRDBT_SECURITY } from "@/lib/assets";

export const dynamic = "force-dynamic";

/** Securities whose marks are kept current from DSE. */
const TRACKED = [CRDBT_SECURITY];

/**
 * Publishing is a privileged write, so it is not open.
 *
 * Unlike settlement, there is no signed-in-customer case: nobody but the
 * platform has a reason to move the mark that settlement prices against.
 */
function permitted(req: Request): boolean {
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!given) return false;
  for (const secret of [process.env.CRON_SECRET, process.env.ADMIN_TOKEN]) {
    if (!secret) continue;
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/**
 * Publishes when the caller is the cron or the desk; otherwise reports.
 *
 * Vercel's scheduler issues GET, so a GET that only read would have left the
 * cron looking scheduled while never once moving a price — the mark would age
 * out and settlement would halt, with nothing in the logs to say why. An
 * unauthenticated GET still answers with the current marks, which is what the
 * UI wants and costs nothing to give.
 */
export async function GET(req: Request) {
  if (permitted(req)) return POST(req);
  const prices = await Promise.all(
    TRACKED.map(async (s) => ({ symbol: s, oracle: await readOraclePrice(s).catch(() => null) })),
  );
  return NextResponse.json({ ok: true, prices }, { headers: { "cache-control": "no-store" } });
}

/**
 * Pushes the latest DSE close for each tracked security.
 *
 * A refusal is reported per security and does not stop the others. Failing to
 * publish leaves the previous mark standing until it ages out, at which point
 * settlement halts on its own — the safe direction. Publishing a bad number
 * would instead settle trades at it.
 */
export async function POST(req: Request) {
  if (!permitted(req)) {
    return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const results = await Promise.all(
    TRACKED.map(async (symbol) => {
      try {
        const r = await publishDsePrice(symbol, { force });
        return { symbol, ...r };
      } catch (e) {
        return { symbol, ok: false as const, reason: e instanceof Error ? e.message : "publish failed" };
      }
    }),
  );

  // A partial failure is still a failure worth a non-200, so a cron run that
  // quietly stopped updating prices does not look healthy in the dashboard.
  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 });
}
