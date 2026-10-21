"use client";

import { useState } from "react";

/**
 * The application form, and the one moment the test key is readable.
 *
 * Everything asked for here is something a person reviewing the application
 * actually needs. Nothing is asked twice and nothing is asked that could be
 * looked up, because a form that collects what it does not use teaches people
 * to type anything into it.
 */

type Issued = { name: string; slug: string; status: string; testKey: string };

type Field = { k: string; label: string; required?: boolean; type?: string;
               ph: string; hint?: string };

const FIELDS: Field[] = [
  { k: "name", label: "Registered company name", required: true, ph: "Acme Financial Services Ltd" },
  { k: "contact_name", label: "Who we should talk to", ph: "Full name" },
  { k: "contact_email", label: "Contact email", required: true, type: "email",
    ph: "name@company.com", hint: "The approval and your live key go here." },
  { k: "contact_phone", label: "Phone", ph: "+255…" },
  { k: "company_reg", label: "Company registration number", ph: "As registered" },
  { k: "country", label: "Country of registration", ph: "TZ" },
  { k: "website", label: "Website", type: "url", ph: "https://" },
];

export function PartnerSignup() {
  const [form, setForm] = useState<Record<string, string>>({ country: "TZ" });
  const [useCase, setUseCase] = useState("");
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/partner/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, use_case: useCase,
          expected_users: expected ? Number(expected) : undefined }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "That application could not be recorded.");
      setIssued({ name: j.partner.name, slug: j.partner.slug, status: j.partner.status,
                  testKey: j.test_key });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <div className="rounded-3xl border hairline p-6 sm:p-8">
        <div className="eyebrow">Application received</div>
        <h2 className="display mt-2 text-2xl">{issued.name} is registered.</h2>
        <p className="mt-3 text-sm text-[var(--muted)]">
          A person at CAPX reads every application. You will hear back at the address you gave,
          and your live key arrives with the approval.
        </p>

        <div className="mt-6 rounded-2xl border hairline p-4">
          <div className="eyebrow">Your test key</div>
          <code className="mt-2 block break-all text-sm">{issued.testKey}</code>
          <p className="mt-2.5 text-xs text-[var(--muted)]">
            Copy it now. Only its hash is stored, so this is the one time it can be read — by you
            or by anybody at CAPX. It reads markets and creates customers; it cannot move money.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a href="/partners/docs"
             className="rounded-full bg-[var(--fg)] px-5 py-2.5 text-sm font-medium text-[var(--bg)]">
            Read the API docs
          </a>
          <a href="/partners/dashboard"
             className="rounded-full border hairline px-5 py-2.5 text-sm font-medium">
            Open your dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border hairline p-6 sm:p-8">
      <div className="eyebrow">Apply</div>
      <h2 className="display mt-2 text-2xl">Tell us who you are.</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        You get a test key immediately and can build while we read this.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.k} className={f.k === "name" ? "sm:col-span-2" : ""}>
            <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
              {f.label}{f.required ? " *" : ""}
            </span>
            <input
              type={f.type ?? "text"}
              value={form[f.k] ?? ""}
              onChange={(e) => set(f.k, e.target.value)}
              placeholder={f.ph}
              className="mt-1 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            {f.hint && (
              <span className="mt-1 block text-[11px] text-[var(--muted)]">{f.hint}</span>
            )}
          </label>
        ))}

        <label>
          <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
            Customers you expect in year one
          </span>
          <input
            value={expected} onChange={(e) => setExpected(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric" placeholder="5000"
            className="mt-1 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </label>

        <label className="sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
            What are you building? *
          </span>
          <textarea
            value={useCase} onChange={(e) => setUseCase(e.target.value)} rows={5}
            placeholder="Who your customers are, which market they want — Dar es Salaam, US, or both — and how they will fund their accounts."
            className="mt-1 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <span className="mt-1 block text-[11px] text-[var(--muted)]">
            This is the part that gets read properly. Regulatory standing in your market matters
            more than volume.
          </span>
        </label>
      </div>

      <button
        onClick={() => void submit()}
        disabled={busy || !form.name || !form.contact_email || !useCase.trim()}
        className="mt-6 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50 sm:w-auto sm:px-8"
      >
        {busy ? "Sending…" : "Apply for access"}
      </button>
      {err && <p className="mt-3 text-xs text-[var(--color-down)]">{err}</p>}
    </div>
  );
}
