"use client";

import { useEffect, useState } from "react";

type Backing = {
  security: string; custodian: string | null;
  underlying: number; locked: number; issued: number; clientHeld: number; unallocated: number;
  ratioPct: number | null; headroom: number;
  fresh: boolean; expiresAt: string | null; lastVerified: string | null;
};
type Security = {
  symbol: string; name: string; token_address: string | null;
  chain_id: number; status: string; backing: Backing;
};

const dt = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * The backing, in public.
 *
 * A custodial claim only its issuer can audit asks to be taken on trust. This
 * page is the alternative: what is held, what has been issued against it, who
 * is holding it and when they last confirmed — readable by anyone, with no
 * account. Under-coverage is stated plainly rather than softened, because a
 * transparency page that only looks good when the news is good is marketing.
 */
export function ProofOfReserves() {
  const [securities, setSecurities] = useState<Security[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/securities", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (alive && j.ok) setSecurities(j.securities ?? []); })
        .catch(() => { if (alive) setSecurities([]); });
    const first = setTimeout(load, 0);
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearTimeout(first); clearInterval(id); };
  }, []);

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-16 pt-6 sm:px-8 sm:pb-24 sm:pt-12">
      <div className="eyebrow">Transparency</div>
      <h1 className="display mt-2 text-[clamp(1.8rem,5vw,3.2rem)]">Every share, accounted for.</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
        Each tokenised security here is backed one-for-one by shares held with a licensed
        custodian. This page shows what is held, what has been issued against it, and when
        custody was last confirmed. It updates on its own and needs no account.
      </p>

      {securities === null ? (
        <div className="mt-10 grid gap-3">
          {[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-3xl surface" />)}
        </div>
      ) : securities.length === 0 ? (
        <p className="mt-10 rounded-3xl border hairline p-8 text-center text-sm text-[var(--muted)]">
          No securities have been issued yet.
        </p>
      ) : (
        <div className="mt-10 grid gap-4">
          {securities.map((s) => {
            const b = s.backing;
            // Under-covered is the only state worth shouting about; a ratio
            // above 100% is a surplus, which is fine.
            const under = b.ratioPct !== null && b.ratioPct < 100;
            return (
              <div
                key={s.symbol}
                className={`rounded-3xl border p-5 sm:p-7 ${
                  under ? "border-[var(--color-down)]/50 bg-[var(--color-down)]/[0.05]" : "hairline"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.03em]">
                        {s.symbol}
                      </h2>
                      <span className="rounded-full surface px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                        {s.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">{s.name}</p>
                  </div>
                  <div className="text-right">
                    <div className="eyebrow">Backing</div>
                    <div className={`tnum text-3xl font-medium ${
                      under ? "text-[var(--color-down)]" : "text-[var(--color-up)]"
                    }`}>
                      {b.ratioPct === null ? "—" : `${b.ratioPct.toFixed(2)}%`}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-6">
                  <Cell label="Underlying shares" value={b.underlying.toLocaleString()} />
                  <Cell label="Locked in custody" value={b.locked.toLocaleString()} />
                  <Cell label="Tokens outstanding" value={b.issued.toLocaleString()} />
                  {/* Buying does not mint and selling does not burn, so this is
                      the figure that explains why tokens outstanding sits still
                      while the tradable pool moves. */}
                  <Cell label="Held by customers" value={b.clientHeld.toLocaleString()} />
                  <Cell label="Available to buy" value={b.unallocated.toLocaleString()} />
                </div>

                <dl className="mt-4 grid gap-1.5 text-[13px] sm:grid-cols-2">
                  <Row k="Custodian" v={b.custodian ?? "Not yet attested"} />
                  <Row k="Last verified" v={dt(b.lastVerified)} />
                  <Row
                    k="Attestation expires"
                    v={b.fresh ? dt(b.expiresAt) : "Expired — issuance is halted"}
                    warn={!b.fresh}
                  />
                  <Row
                    k="Token"
                    v={s.token_address ? `${s.token_address.slice(0, 10)}…${s.token_address.slice(-6)}` : "Not deployed"}
                  />
                </dl>

                {under && (
                  <p className="mt-4 rounded-2xl border border-[var(--color-down)]/40 p-3 text-xs leading-relaxed text-[var(--color-down)]">
                    Tokens outstanding exceed the shares locked in custody. Further issuance is
                    blocked automatically until the position is restored.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg)] px-4 py-3">
      <div className="eyebrow leading-tight">{label}</div>
      <div className="tnum mt-1.5 text-lg font-medium">{value}</div>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b hairline py-1.5 last:border-0">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className={`tnum min-w-0 truncate text-right ${warn ? "text-[var(--color-down)]" : ""}`}>{v}</dd>
    </div>
  );
}
