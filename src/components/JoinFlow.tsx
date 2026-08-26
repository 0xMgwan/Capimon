"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Reveal, RevealWords } from "@/components/Reveal";
import { UsdcIcon } from "@/components/icons/Usdc";
import { usd } from "@/lib/format";

const TZS = (n: number) => `${Math.round(n).toLocaleString()} TZS`;

type Account = {
  user: { id: string; email: string; name: string | null; ntzsUserId: string | null; kycStatus: string };
  cash: number;
  equity: number;
  total: number;
  capabilities: { ntzs: boolean; trading: boolean };
};

async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.note ? `${j.error} ${j.note}` : j.error ?? "Request failed");
  return j as T;
}

/**
 * Onboarding for people without a wallet.
 *
 * This is the custodial path: CAPIMON opens an account, collects shillings
 * through nTZS, converts them to USDC and holds the resulting shares, recording
 * what each account is owed. Anyone who would rather hold their own keys should
 * connect a wallet instead, and the copy says so plainly.
 */
export function JoinFlow() {
  const [account, setAccount] = useState<Account | null>(null);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "", nidaNumber: "" });
  const [amountTzs, setAmountTzs] = useState(50_000);
  const [ntzsBalance, setNtzsBalance] = useState(0);

  const load = useCallback(async () => {
    try {
      setAccount(await api<Account>("/api/account/me"));
    } catch {
      setAccount(null);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };

  const signedIn = !!account?.user;
  const step = !signedIn ? 1 : ntzsBalance <= 0 && account.cash <= 0 ? 2 : account.cash <= 0 ? 3 : 4;

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-12 sm:px-8">
      <Reveal>
        <div className="eyebrow">Open an account</div>
        <h1 className="display mt-3 max-w-3xl text-[clamp(2.2rem,6vw,4.5rem)]">
          <RevealWords text="Shillings in." />{" "}
          <span className="font-[family-name:var(--font-serif)] font-light italic text-[var(--muted)]">
            <RevealWords text="Shares out." delay={0.1} />
          </span>
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--muted)]">
          Fund with mobile money in Tanzanian shillings and buy tokenized equities — no wallet, no
          seed phrase. CAPIMON holds the assets for you and records what you are owed.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,520px)_1fr] lg:gap-16">
        <div>
          {/* 1 — account */}
          <Step n={1} active={step === 1} done={signedIn} title={signedIn ? "Account open" : "Create your account"}>
            {signedIn ? (
              <p className="text-sm text-[var(--muted)]">Signed in as {account.user.email}.</p>
            ) : (
              <>
                <div className="mb-3 flex rounded-full surface p-1">
                  {(["register", "login"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setMode(m); setError(null); }}
                      className={`flex-1 rounded-full py-2 text-sm font-medium capitalize transition-colors ${
                        mode === m ? "bg-[var(--bg)] shadow-sm" : "text-[var(--muted)]"
                      }`}
                    >
                      {m === "register" ? "New account" : "Sign in"}
                    </button>
                  ))}
                </div>
                <div className="grid gap-2.5">
                  <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="you@example.com" />
                  <Field label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} hint={mode === "register" ? "10+ characters, letters and numbers" : undefined} />
                  {mode === "register" && (
                    <>
                      <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="As on your NIDA" />
                      <Field label="Mobile money number" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} inputMode="numeric" placeholder="255712345678" />
                      <Field label="NIDA number" value={form.nidaNumber} onChange={(v) => setForm({ ...form, nidaNumber: v })} inputMode="numeric" placeholder="20 digits" hint={`${form.nidaNumber.replace(/\D/g, "").length}/20`} />
                    </>
                  )}
                </div>
                <button
                  onClick={() => run(async () => {
                    await api(mode === "register" ? "/api/account/register" : "/api/account/login", form);
                    await load();
                    setNotice(mode === "register" ? "Account open. Fund it with mobile money below." : null);
                  })}
                  disabled={busy}
                  className="mt-4 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                >
                  {busy ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
                </button>
              </>
            )}
          </Step>

          {/* 2 — deposit */}
          <Step n={2} active={step === 2} done={ntzsBalance > 0 || (account?.cash ?? 0) > 0} title="Fund with mobile money">
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              You&rsquo;ll get a prompt on your phone. Approving it mints nTZS one-for-one with the
              shillings you send.
            </p>
            <div className="mt-4 grid gap-2.5">
              <Field label="Amount (TZS)" value={String(amountTzs)} onChange={(v) => setAmountTzs(Number(v.replace(/\D/g, "")) || 0)} inputMode="numeric" hint="min 500" />
              <Field label="Mobile money number" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} inputMode="numeric" placeholder="255712345678" />
            </div>
            <button
              onClick={() => run(async () => {
                const r = await api<{ note: string }>("/api/ntzs/deposit", {
                  userId: account?.user.ntzsUserId, amountTzs, phoneNumber: form.phone,
                });
                setNotice(r.note);
                setNtzsBalance(amountTzs);
              })}
              disabled={busy || !signedIn || amountTzs < 500}
              className="mt-4 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
            >
              {busy ? "Sending prompt…" : `Deposit ${TZS(amountTzs)}`}
            </button>
          </Step>

          {/* 3 — convert */}
          <Step n={3} active={step === 3} done={(account?.cash ?? 0) > 0} title="Convert to trading balance">
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              Your shillings convert to USDC and become your CAPIMON balance, ready to buy with.
            </p>
            <button
              onClick={() => run(async () => {
                const r = await api<{ usdcCredited: number }>("/api/ntzs/fund", { amountTzs: ntzsBalance || amountTzs });
                setNotice(`${usd(r.usdcCredited)} credited to your balance.`);
                setNtzsBalance(0);
                await load();
              })}
              disabled={busy || !signedIn}
              className="mt-4 w-full rounded-full bg-[var(--fg)] py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
            >
              {busy ? "Converting…" : "Convert to USDC"}
            </button>
          </Step>

          {/* 4 — trade */}
          <Step n={4} active={step === 4} done={false} title="Buy shares" last>
            <div className="rounded-2xl surface p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-[var(--muted)]"><UsdcIcon className="h-3.5 w-3.5" /> Available</span>
                <span className="tnum">{usd(account?.cash ?? 0)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">Shares held</span>
                <span className="tnum">{usd(account?.equity ?? 0)}</span>
              </div>
            </div>
            <Link href="/markets" className="mt-4 block rounded-full bg-[var(--fg)] py-3.5 text-center text-sm font-medium text-[var(--bg)]">
              Browse markets →
            </Link>
          </Step>
        </div>

        <Reveal delay={0.08}>
          <aside className="lg:sticky lg:top-36">
            <AnimatePresence mode="popLayout">
              {(error || notice) && (
                <motion.div
                  key={error ?? notice ?? ""}
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`mb-5 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
                    error ? "border-[var(--color-down)]/40 bg-[var(--color-down)]/[0.06] text-[var(--color-down)]" : "hairline text-[var(--muted)]"
                  }`}
                >
                  {error ?? notice}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="rounded-3xl border border-[#b45309]/40 bg-[#b45309]/[0.05] p-5">
              <div className="text-sm font-medium text-[#b45309]">This account is custodial</div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                CAPIMON holds the USDC and the shares, and its ledger records what you are owed. You
                are trusting CAPIMON to remain solvent and to honour that record — which is the price
                of not needing a wallet.{" "}
                <Link href="/markets" className="underline underline-offset-2 hover:text-[var(--fg)]">
                  Connect your own wallet instead
                </Link>{" "}
                and CAPIMON holds nothing.
              </p>
            </div>

            <div className="mt-5 rounded-3xl border hairline p-6">
              <div className="eyebrow">Where your money goes</div>
              <ol className="mt-4 space-y-4 text-sm leading-relaxed text-[var(--muted)]">
                <li><span className="text-[var(--fg)]">Mobile money → nTZS.</span> Held against the shilling reserve.</li>
                <li><span className="text-[var(--fg)]">nTZS → USDC.</span> Converted at the live rate.</li>
                <li><span className="text-[var(--fg)]">USDC → CAPIMON.</span> Held in the treasury; your balance is credited.</li>
                <li><span className="text-[var(--fg)]">USDC → shares.</span> CAPIMON trades and records your holding.</li>
              </ol>
              <p className="mt-5 border-t hairline pt-4 text-[11px] leading-relaxed text-[var(--muted)]">
                Tokenized equities are not available to US persons. Nothing here is investment advice.
              </p>
            </div>
          </aside>
        </Reveal>
      </div>
    </div>
  );
}

function Step({
  n, title, children, active, done, last,
}: { n: number; title: string; children: React.ReactNode; active: boolean; done: boolean; last?: boolean }) {
  return (
    <div className={`relative pl-11 ${last ? "" : "pb-8"}`}>
      {!last && <span className="absolute left-[15px] top-9 h-[calc(100%-2rem)] w-px bg-[var(--border)]" />}
      <span className={`absolute left-0 top-0 grid h-8 w-8 place-items-center rounded-full border text-xs font-medium transition-colors ${
        done ? "border-transparent bg-[var(--color-up)] text-white"
             : active ? "border-transparent bg-[var(--fg)] text-[var(--bg)]"
             : "hairline text-[var(--muted)]"}`}>
        {done ? "✓" : n}
      </span>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-medium tracking-[-0.03em]">{title}</h2>
      <div className={`mt-2 ${active || done ? "" : "opacity-55"}`}>{children}</div>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder, inputMode, hint,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
  placeholder?: string; inputMode?: "numeric" | "text"; hint?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow flex items-center justify-between gap-2">
        {label}
        {hint && <span className="normal-case tracking-normal">{hint}</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete={type === "password" ? "current-password" : undefined}
        className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--color-accent)]"
      />
    </label>
  );
}
