import { NextResponse } from "next/server";
import { db, migrate } from "@/lib/db";
import { requireDb, boom } from "@/lib/apiHelpers";
import { providerByToken, capacityOf, providers } from "@/lib/liquidity";
import { roleOf } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const tokenFrom = (req: Request) =>
  (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  || new URL(req.url).searchParams.get("token")
  || "";

/**
 * A liquidity provider's own view of the facility.
 *
 * They are being asked to hold money and buy on demand, so they are owed a
 * clear account of what that has cost them and what it has earned: what they
 * are holding, what it is worth now, what they paid, and every fill the
 * standing bid took on their behalf.
 *
 * CAPX can read any provider; a provider reads only themselves. Nothing here
 * carries a customer's position — who sold is not a provider's business, only
 * that inventory came back and they bought it.
 */
export async function GET(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const token = tokenFrom(req);
    const isAdmin = roleOf(req) === "admin";
    const me = isAdmin ? null : await providerByToken(token);
    if (!isAdmin && !me) {
      return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
    }

    await migrate();
    const sql = db();
    const list = me ? [me] : await providers();

    const out = await Promise.all(list.map(async (p) => {
      const cap = await capacityOf(p);

      /*
       * The spread, over the whole history rather than the last forty fills.
       *
       * Buying at a discount d means the shares received are worth
       * spend/(1-d), so the earning is spend/(1-d) - spend. Taking it as
       * spend*d understates it slightly and, more to the point, is not what
       * the arithmetic does.
       */
      const [absorbed] = await sql<{ total: string }[]>`
        select coalesce(sum(tzs), 0)::text as total from capx.lp_fills
         where provider_id = ${p.id}::uuid and side = 'buy'`;
      const spentTzs = Number(absorbed?.total ?? 0);
      const d = p.spreadBps / 10_000;
      const earnedTzs = d > 0 && d < 1 ? spentTzs / (1 - d) - spentTzs : 0;

      const fills = await sql<{ symbol: string; qty: string; tzs: string;
                                side: string; created_at: string }[]>`
        select symbol, qty::text, tzs::text, side, created_at
          from capx.lp_fills where provider_id = ${p.id}::uuid
         order by created_at desc limit 40`;

      /* What they hold, per security, at cost and at the mark — the two
         numbers that say whether the facility is currently a profit or a
         position. */
      const { dseSecurities } = await import("@/lib/dseSecurities");
      const { readOraclePrice } = await import("@/lib/oracle");
      const { balanceOf } = await import("@/lib/ledger");
      const secs = await dseSecurities().catch(() => []);

      const holdings = [];
      for (const sec of secs) {
        const qty = await balanceOf(p.userId, sec.symbol).catch(() => 0);
        if (!(qty > 0)) continue;
        const mark = await readOraclePrice(sec.symbol).then((q) => q?.price ?? 0).catch(() => 0);
        const [cost] = await sql<{ paid: string }[]>`
          select coalesce(sum(case when side = 'sell' then -tzs else tzs end), 0)::text as paid
            from capx.lp_fills
           where provider_id = ${p.id}::uuid and symbol = ${sec.symbol}`;
        holdings.push({
          symbol: sec.symbol, qty, markTzs: mark, valueTzs: qty * mark,
          paidTzs: Number(cost?.paid ?? 0),
        });
      }

      return {
        id: p.id, name: p.name, active: p.active,
        committedTzs: p.committedTzs, maxDailyTzs: p.maxDailyTzs,
        floorTzs: p.floorTzs, bandPct: p.bandPct,
        ...cap,
        holdings,
        minMarginPct: p.minMarginPct,
        spreadBps: p.spreadBps,
        absorbedTzs: spentTzs,
        earnedTzs,
        fills: fills.map((f) => ({
          symbol: f.symbol, qty: Number(f.qty), tzs: Number(f.tzs),
          side: f.side === "sell" ? "sell" : "buy", at: f.created_at,
        })),
      };
    }));

    const { releasableTzs } = await import("@/lib/liquidity");
    return NextResponse.json(
      { ok: true, admin: isAdmin, providers: out, releasableTzs: await releasableTzs() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return boom(e, "Could not read the facility");
  }
}

/**
 * The provider's own switch, and CAPX's terms.
 *
 * A provider can pause and resume themselves — a standing bid nobody can stop
 * is not a facility, it is an obligation — and that is all they can change.
 * The terms are the agreement and belong to whoever agreed them, so only CAPX
 * writes those.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const body = await req.json().catch(() => ({}));
    const isAdmin = roleOf(req) === "admin";
    const me = isAdmin ? null : await providerByToken(tokenFrom(req));
    if (!isAdmin && !me) {
      return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });
    }

    await migrate();
    const sql = db();
    /*
     * Onboarding a provider, which only CAPX can do.
     *
     * The token is generated here and returned exactly once, because only its
     * hash is stored — there is no route that can show it again, which is the
     * point. It is tied to an ordinary CAPX account: the provider's shillings
     * sit in the omnibus like everybody's, and that is what makes the standing
     * bid a ledger reassignment rather than a wire nobody is awake to send.
     */
    if (isAdmin && body.action === "create") {
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!name || !email) {
        return NextResponse.json(
          { ok: false, error: "A name and the account's email are both required." },
          { status: 400 },
        );
      }
      const [u] = await sql<{ id: string; kyc_status: string }[]>`
        select id::text, kyc_status from capx.users where lower(email) = ${email}`;
      if (!u) {
        return NextResponse.json(
          { ok: false, error: `No CAPX account for ${email}. They need one first — that is where their shillings sit.` },
          { status: 400 },
        );
      }
      const { randomBytes } = await import("crypto");
      const token = randomBytes(32).toString("base64url");
      const { lpTokenHash } = await import("@/lib/liquidity");
      await sql`
        insert into capx.liquidity_providers (name, user_id, token_hash, floor_tzs, active)
        values (${name}, ${u.id}::uuid, ${lpTokenHash(token)}, 0, true)`;
      return NextResponse.json({
        ok: true, token,
        note: "Copy this token now — only its hash is kept, so it cannot be shown again.",
        /* Said now rather than discovered later: the bid buys through the
           ordinary order path, which refuses an unverified account. */
        warning: u.kyc_status === "approved" ? undefined
          : `That account is not verified yet, so the bid will not fill for it. `
            + `Verify it and fund it with shillings, and the facility starts working with no `
            + `further change here.`,
      });
    }

    const id = me?.id ?? String(body.id ?? "");
    if (!id) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

    /*
     * Unwind now, rather than at the next tick.
     *
     * The scheduled release runs three times a day, which is right for
     * something routine and wrong for a provider who has decided they want
     * their cash back. The same gate applies either way — it will not sell
     * into a float that cannot carry the claim — so the only thing this
     * changes is when it is asked.
     */
    if (body.action === "release") {
      const { releaseInventory, releasableTzs } = await import("@/lib/liquidity");
      const budget = await releasableTzs();
      const done = await releaseInventory();
      return NextResponse.json({
        ok: true,
        released: done,
        note: done
          ? `Sold ${Math.round(done.releasedTzs).toLocaleString()} TZS of inventory back into the pool.`
          : budget !== null && budget <= 0
            ? "Nothing was sold: the float cannot carry another shilling claim right now. "
              + "It will release on its own as soon as it can."
            : "Nothing was sold — either there is no inventory to release, or every mark is "
              + "below the margin floor you have set.",
      });
    }

    if (typeof body.active === "boolean") {
      await sql`update capx.liquidity_providers set active = ${body.active} where id = ${id}::uuid`;
    }

    if (isAdmin) {
      // Null clears a term, which is how "no limit agreed" is expressed.
      const num = (v: unknown) =>
        v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : undefined;
      const committed = num(body.committedTzs);
      const daily = num(body.maxDailyTzs);
      const floor = num(body.floorTzs);
      const band = num(body.bandPct);
      const margin = num(body.minMarginPct);
      const spread = num(body.spreadBps);
      if (committed !== undefined) {
        await sql`update capx.liquidity_providers set committed_tzs = ${committed} where id = ${id}::uuid`;
      }
      if (daily !== undefined) {
        await sql`update capx.liquidity_providers set max_daily_tzs = ${daily} where id = ${id}::uuid`;
      }
      if (floor !== undefined && floor !== null) {
        await sql`update capx.liquidity_providers set floor_tzs = ${floor} where id = ${id}::uuid`;
      }
      if (band !== undefined) {
        await sql`update capx.liquidity_providers set band_pct = ${band} where id = ${id}::uuid`;
      }
      if (margin !== undefined) {
        await sql`update capx.liquidity_providers set min_margin_pct = ${margin} where id = ${id}::uuid`;
      }
      if (spread !== undefined) {
        await sql`update capx.liquidity_providers set spread_bps = ${spread} where id = ${id}::uuid`;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return boom(e, "Could not update the facility");
  }
}
