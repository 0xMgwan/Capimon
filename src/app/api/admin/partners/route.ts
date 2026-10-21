import { NextResponse } from "next/server";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { roleOf } from "@/lib/adminAuth";
import { partners, usageFor, issueKey, type PartnerStatus } from "@/lib/partners";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

const gateAdmin = (req: Request) =>
  roleOf(req) === "admin" ? null
    : NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

/** Every applicant and every partner, with what they have actually done. */
export async function GET(req: Request) {
  const gate = requireDb(); if (gate) return gate;
  const denied = gateAdmin(req); if (denied) return denied;
  try {
    const list = await partners();
    const withUsage = await Promise.all(list.map(async (p) => ({
      ...p, usage: await usageFor(p.id, 7).catch(() => null),
    })));
    return NextResponse.json({ ok: true, partners: withUsage },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return boom(e, "Could not read the partners.");
  }
}

/**
 * CAPX's side of the agreement: status, terms, and the live key.
 *
 * A live key is issued only by approving, and only here. That is the single
 * place where a company stops being an application and starts being able to
 * move a customer's money, and it should take a person deciding it.
 */
export async function POST(req: Request) {
  const gate = requireDb(); if (gate) return gate;
  const denied = gateAdmin(req); if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id ?? "");
    if (!id) return bad("Name the partner with `id`.");

    await migrate();
    const sql = db();

    if (typeof body.status === "string") {
      const status = body.status as PartnerStatus;
      if (!["pending", "approved", "suspended", "rejected"].includes(status)) {
        return bad("Status must be pending, approved, suspended or rejected.");
      }
      await sql`
        update capx.partners
           set status = ${status}, reviewed_at = now(), reviewed_by = 'CAPX'
         where id = ${id}::uuid`;

      if (status === "approved") {
        const key = await issueKey(id, "live", "Issued on approval");
        const [p] = await sql<{ name: string; contact_email: string }[]>`
          select name, contact_email from capx.partners where id = ${id}::uuid`;

        /* Mailed to them rather than shown here: a live key belongs in the
           hands of the partner, and the fewer screens it crosses the better. */
        void import("@/lib/mail").then((m) => m.sendMail({
          to: p?.contact_email,
          subject: "Your CAPX partner account is approved",
          text:
            `${p?.name} is approved to build on CAPX.\n\n` +
            `Live key: ${key}\n\n` +
            `This is the only time it is shown — only its hash is stored, so nobody at CAPX ` +
            `can read it back to you. Keep it server-side; it moves real money.\n\n` +
            `Docs: https://www.capx.broker/partners/docs\n` +
            `Dashboard: https://www.capx.broker/partners/dashboard`,
        })).catch(() => {});

        return NextResponse.json({ ok: true, status, live_key: key,
          note: "Shown once here and mailed to the partner's contact address." });
      }
      return NextResponse.json({ ok: true, status });
    }

    /* The commercial terms. Null clears a ceiling, meaning none is agreed. */
    const num = (v: unknown) =>
      v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : undefined;
    const fee = num(body.fee_bps);
    const maxOrder = num(body.max_order_tzs);
    const maxDaily = num(body.max_daily_tzs);

    if (fee !== undefined) {
      const capped = fee === null ? 0 : Math.max(0, Math.min(250, Math.round(fee)));
      await sql`update capx.partners set fee_bps = ${capped} where id = ${id}::uuid`;
    }
    if (maxOrder !== undefined) {
      await sql`update capx.partners set max_order_tzs = ${maxOrder} where id = ${id}::uuid`;
    }
    if (maxDaily !== undefined) {
      await sql`update capx.partners set max_daily_tzs = ${maxDaily} where id = ${id}::uuid`;
    }
    if (typeof body.notes === "string") {
      await sql`update capx.partners set notes = ${body.notes.slice(0, 4000)} where id = ${id}::uuid`;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return boom(e, "Could not update that partner.");
  }
}
