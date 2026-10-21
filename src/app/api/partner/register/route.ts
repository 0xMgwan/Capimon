import { NextResponse } from "next/server";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { applyToPartner } from "@/lib/partners";

export const dynamic = "force-dynamic";

/**
 * A company applying to build on CAPX.
 *
 * Public and unauthenticated, because the whole point is that somebody who
 * does not have a key can ask for one. It creates a pending record and issues
 * a test key immediately — they can read markets and create customers while
 * the application is read, and can move nothing until a person approves it.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;

  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const contactEmail = String(body.contact_email ?? "").trim().toLowerCase();

    if (name.length < 2) return bad("Enter the company's registered name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
      return bad("Enter a valid contact email — this is where the approval goes.");
    }

    const expected = Number(body.expected_users);
    const { partner, testKey } = await applyToPartner({
      name,
      contactName: body.contact_name ? String(body.contact_name).trim() : undefined,
      contactEmail,
      contactPhone: body.contact_phone ? String(body.contact_phone).trim() : undefined,
      companyReg: body.company_reg ? String(body.company_reg).trim() : undefined,
      country: body.country ? String(body.country).trim() : undefined,
      website: body.website ? String(body.website).trim() : undefined,
      useCase: body.use_case ? String(body.use_case).trim().slice(0, 4000) : undefined,
      expectedUsers: Number.isFinite(expected) ? Math.max(0, Math.round(expected)) : undefined,
    });

    /* A person has to read this, so a person is told. */
    void import("@/lib/mail").then((m) => m.sendMail({
      subject: `CAPX: ${partner.name} applied for partner access`,
      text:
        `${partner.name} (${contactEmail}) has applied to build on CAPX.\n\n` +
        `Country: ${partner.country}\n` +
        `Website: ${partner.website ?? "—"}\n` +
        `Registration: ${partner.companyReg ?? "—"}\n` +
        `Expected customers: ${partner.expectedUsers ?? "—"}\n\n` +
        `What they want to build:\n${partner.useCase ?? "—"}\n\n` +
        `They hold a test key already and can move no money until approved. ` +
        `Approve or decline on the partners panel.`,
    })).catch(() => {});

    return NextResponse.json({
      ok: true,
      partner: { id: partner.id, name: partner.name, slug: partner.slug, status: partner.status },
      test_key: testKey,
      note: "Copy the test key now — only its hash is stored, so it cannot be shown again. "
          + "It reads markets and creates customers; it cannot move money.",
    }, { status: 201 });
  } catch (e) {
    return boom(e, "Could not record that application.");
  }
}
