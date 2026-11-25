import { NextResponse } from "next/server";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { applyToPartner } from "@/lib/partners";

export const dynamic = "force-dynamic";

/**
 * A company applying to build on CAPX, or just asking to look at the data.
 *
 * Public and unauthenticated, because the whole point is that somebody who
 * does not have a key can ask for one. It creates a pending record and issues
 * a test key immediately — they can read markets and create customers while
 * the application is read, and can move nothing until a person approves it.
 *
 * Two intents arrive here and only the covering note differs. `evaluate` is
 * somebody deciding whether the prices, volumes and attestations are worth
 * paying for, and asking them to write a page about their funding rails
 * first is how you lose them before they have seen anything. `apply` is a
 * company asking to go live. The gate is the same either way, because what
 * separates the two is approval, not the form they filled in: a test key
 * reads everything and moves nothing, whoever holds it.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;

  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const contactEmail = String(body.contact_email ?? "").trim().toLowerCase();
    /* Anything that is not plainly an application is treated as a look, which
       is the reading that asks less of the person and claims less to us. */
    const evaluating = String(body.intent ?? "evaluate") !== "apply";

    if (name.length < 2) {
      return bad(evaluating
        ? "Enter the name of your company or project."
        : "Enter the company's registered name.");
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
      return bad("Enter a valid contact email — this is where your key goes.");
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

    void import("@/lib/mail").then((m) => {
      /* A person has to read this, so a person is told — and told which of
         the two things just happened, because an evaluation waiting on
         nobody and an application waiting on us need different attention. */
      void m.sendMail({
        subject: evaluating
          ? `CAPX: ${partner.name} is evaluating the API`
          : `CAPX: ${partner.name} applied for partner access`,
        text:
          (evaluating
            ? `${partner.name} (${contactEmail}) took a test key to evaluate the market data. ` +
              `Nothing is required of you — they can read markets, history and attestation ` +
              `already, and can move nothing. Worth a note if you want to follow up.\n\n`
            : `${partner.name} (${contactEmail}) has applied to build on CAPX.\n\n`) +
          `Country: ${partner.country}\n` +
          `Website: ${partner.website ?? "—"}\n` +
          `Registration: ${partner.companyReg ?? "—"}\n` +
          `Expected customers: ${partner.expectedUsers ?? "—"}\n\n` +
          `What they want to build:\n${partner.useCase || "—"}\n\n` +
          (evaluating
            ? `Nothing to approve. If they come back wanting to move money they will apply ` +
              `properly and you will get the application then.`
            : `They hold a test key already and can move no money until approved. ` +
              `Approve or decline on the partners panel.`),
      }).catch(() => {});

      /*
       * And the key itself, to them.
       *
       * The form shows it once and that was the only copy: the dashboard
       * authenticates with the key, and rotating one requires calling with a
       * valid key, so somebody who closed the tab had no way back in except
       * registering a second time under a slightly different name. Mailing it
       * is the cheapest fix and it is the same thing approval already does
       * with the live key.
       *
       * This is a credential in plain email, which is worth being deliberate
       * about rather than silent on. A test key reads and creates customers
       * and cannot move a shilling, it is revocable from the dashboard, and
       * the alternative was a locked-out integrator. A live key still only
       * ever leaves on approval.
       */
      void m.sendMail({
        to: contactEmail,
        subject: "Your CAPX test key",
        text:
          `${partner.name} is registered on CAPX.\n\n` +
          `Test key: ${testKey}\n\n` +
          `It reads every market endpoint — prices, history with volume, backing and ` +
          `attestation — against the same data CAPX's own charts are drawn from. It can ` +
          `also create customers. It cannot move money, so there is nothing it can do ` +
          `that costs anybody anything.\n\n` +
          `Three calls worth making first:\n\n` +
          `  export KEY=${testKey}\n\n` +
          `  curl -H "Authorization: Bearer $KEY" \\\n` +
          `    https://www.capx.broker/api/partner/v1/markets\n\n` +
          `  curl -H "Authorization: Bearer $KEY" \\\n` +
          `    "https://www.capx.broker/api/partner/v1/markets/CRDB/history?days=90"\n\n` +
          `  curl -H "Authorization: Bearer $KEY" \\\n` +
          `    https://www.capx.broker/api/partner/v1/attestation\n\n` +
          (evaluating
            ? `Nothing is pending at your end. When you want to move money for real ` +
              `customers, tell us what you are building and a person reads it — the live ` +
              `key arrives with the approval and nothing else in your integration changes.\n\n`
            : `A person at CAPX reads every application. You will hear back at this address, ` +
              `and your live key arrives with the approval.\n\n`) +
          `Docs: https://www.capx.broker/partners/docs\n` +
          `Dashboard: https://www.capx.broker/partners/dashboard\n\n` +
          `Keep it server-side, and rotate it from the dashboard if it leaks.`,
        replyTo: m.opsEmail,
      }).catch(() => {});
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      partner: { id: partner.id, name: partner.name, slug: partner.slug, status: partner.status },
      test_key: testKey,
      note: "Copy the test key now — only its hash is stored, so CAPX cannot show it again. "
          + "A copy has been mailed to the address you gave, which is the only way back to it. "
          + "It reads markets and creates customers; it cannot move money.",
    }, { status: 201 });
  } catch (e) {
    return boom(e, "Could not record that application.");
  }
}
