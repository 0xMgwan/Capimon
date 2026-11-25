"use client";

import { useState } from "react";

/**
 * The application form, and the one moment the test key is readable on screen.
 *
 * Two doors, one endpoint. Somebody deciding whether CAPX's prices, volumes
 * and attestations are worth paying for needs a key and nothing else, and the
 * old single form asked them for a registration number and a page on how
 * their customers would fund their accounts before it would hand one over.
 * That question is the right question to ask a company going live and the
 * wrong one to ask a developer with a terminal open, and asking it first lost
 * people who had not yet seen a single price.
 *
 * So the evaluation door asks for a name and an email, and the application
 * door asks everything a reviewer actually reads. What separates the two is
 * approval rather than the form: both get the same test key, which reads
 * everything and moves nothing.
 *
 * Everything asked for on the application side is something a person reviewing
 * it actually needs. Nothing is asked twice and nothing is asked that could be
 * looked up, because a form that collects what it does not use teaches people
 * to type anything into it.
 */

type Mode = "evaluate" | "apply";

type Issued = { name: string; slug: string; status: string; testKey: string; mode: Mode };

type Field = { k: string; label: string; required?: boolean; type?: string;
               ph: string; hint?: string; applyOnly?: boolean };

const FIELDS: Field[] = [
  { k: "name", label: "Company or project", required: true, ph: "Acme Financial Services Ltd" },
  { k: "contact_email", label: "Contact email", required: true, type: "email",
    ph: "name@company.com", hint: "Your key is mailed here." },
  { k: "contact_name", label: "Who we should talk to", ph: "Full name", applyOnly: true },
  { k: "contact_phone", label: "Phone", ph: "+255…", applyOnly: true },
  { k: "company_reg", label: "Company registration number", ph: "As registered", applyOnly: true },
  { k: "country", label: "Country of registration", ph: "TZ", applyOnly: true },
  { k: "website", label: "Website", type: "url", ph: "https://", applyOnly: true },
];

const CURL = `export KEY=cpx_test_…

# every tradeable security, both boards
curl -H "Authorization: Bearer $KEY" \\
  https://www.capx.broker/api/partner/v1/markets

# 90 days of CRDB, candles with volume
curl -H "Authorization: Bearer $KEY" \\
  "https://www.capx.broker/api/partner/v1/markets/CRDB/history?days=90"

# what is held against what is owed, right now
curl -H "Authorization: Bearer $KEY" \\
  https://www.capx.broker/api/partner/v1/attestation`;

export function PartnerSignup() {
  const [mode, setMode] = useState<Mode>("evaluate");
  const [form, setForm] = useState<Record<string, string>>({ country: "TZ" });
  const [useCase, setUseCase] = useState("");
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const applying = mode === "apply";
  const fields = FIELDS.filter((f) => applying || !f.applyOnly);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/partner/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, intent: mode, use_case: useCase,
          expected_users: expected ? Number(expected) : undefined }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "That application could not be recorded.");
      setIssued({ name: j.partner.name, slug: j.partner.slug, status: j.partner.status,
                  testKey: j.test_key, mode });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    const evaluated = issued.mode === "evaluate";
    return (
      <div className="rounded-3xl border hairline p-6 sm:p-8">
        <div className="eyebrow">{evaluated ? "Key issued" : "Application received"}</div>
        <h2 className="display mt-2 text-2xl">
          {evaluated ? "Go and read the data." : `${issued.name} is registered.`}
        </h2>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {evaluated
            ? "Nothing is pending at your end and nobody has to approve anything. The key below "
              + "reads every market endpoint against the same data CAPX draws its own charts from."
            : "A person at CAPX reads every application. You will hear back at the address you gave, "
              + "and your live key arrives with the approval."}
        </p>

        <div className="mt-6 rounded-2xl border hairline p-4">
          <div className="eyebrow">Your test key</div>
          <code className="mt-2 block break-all text-sm">{issued.testKey}</code>
          <p className="mt-2.5 text-xs text-[var(--muted)]">
            Copy it now. Only its hash is stored, so this is the one time it can be read on
            screen — by you or by anybody at CAPX. A copy is on its way to your email, which is
            the only way back to it. It reads markets and creates customers; it cannot move money.
          </p>
        </div>

        {evaluated && (
          <div className="mt-5">
            <div className="eyebrow">Start here</div>
            <pre className="mt-2 overflow-x-auto rounded-2xl surface p-4 text-[11.5px] leading-relaxed">
{CURL}
            </pre>
          </div>
        )}

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
      {/* The choice first, because it changes what is being asked of them. */}
      <div className="flex rounded-full surface p-0.5 text-[12px]">
        {([["evaluate", "Try the data"], ["apply", "Apply to go live"]] as const).map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 rounded-full px-3 py-2 font-medium transition-colors ${
              mode === m ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
            }`}>
            {label}
          </button>
        ))}
      </div>

      <h2 className="display mt-5 text-2xl">
        {applying ? "Tell us who you are." : "Get a test key."}
      </h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {applying
          ? "You get a test key immediately and can build while we read this."
          : "Prices, charts, volumes, backing and attestation — a name and an email, and you are "
            + "reading live data a minute from now. No approval, no card, nothing to cancel."}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
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

        {applying && (
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
        )}

        <label className="sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
            What are you building?{applying ? " *" : " (optional)"}
          </span>
          <textarea
            value={useCase} onChange={(e) => setUseCase(e.target.value)} rows={applying ? 5 : 2}
            placeholder={applying
              ? "Who your customers are, which market they want — Dar es Salaam, US, or both — and how they will fund their accounts."
              : "A line is plenty, and you can skip it."}
            className="mt-1 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          {applying && (
            <span className="mt-1 block text-[11px] text-[var(--muted)]">
              This is the part that gets read properly. Regulatory standing in your market matters
              more than volume.
            </span>
          )}
        </label>
      </div>

      <button
        onClick={() => void submit()}
        disabled={busy || !form.name || !form.contact_email || (applying && !useCase.trim())}
        className="mt-6 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50 sm:w-auto sm:px-8"
      >
        {busy ? "Sending…" : applying ? "Apply for access" : "Get my test key"}
      </button>
      {err && <p className="mt-3 text-xs text-[var(--color-down)]">{err}</p>}

      <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--muted)]">
        {applying
          ? "Reading the data needs none of this — switch to “Try the data” for a key in two fields."
          : "A test key cannot move money, so going live later means applying properly. Nothing you "
            + "build against it changes when the live key arrives; you swap the key."}
      </p>
    </div>
  );
}
