"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type Backing = {
  security: string; custodian: string | null;
  underlying: number; locked: number; issued: number; clientHeld: number; unallocated: number;
  ratioPct: number | null; headroom: number;
  fresh: boolean; expiresAt: string | null; lastVerified: string | null;
};
type Security = {
  symbol: string; name: string; token_address: string | null;
  chain_id: number; status: string; backing: Backing;
  /** "external": a token another issuer made, which CAPX buys and holds. */
  kind?: "dse" | "external"; issuer?: string | null; buyOnly?: boolean; held?: number | null;
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
  const { t } = useT();
  const [securities, setSecurities] = useState<Security[] | null>(null);
  /*
   * Which security the visitor came to see.
   *
   * "Proof of reserves" on the NMB page landed on a list that opens with CRDB,
   * which read as the wrong page. The link now carries #nmb, and that card is
   * scrolled to and outlined once the list has loaded.
   */
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setFocus(window.location.hash.slice(1).toUpperCase() || null);
    const id = setTimeout(read, 0);
    window.addEventListener("hashchange", read);
    return () => { clearTimeout(id); window.removeEventListener("hashchange", read); };
  }, []);
  useEffect(() => {
    if (!focus || !securities?.length) return;
    const id = setTimeout(() => document.getElementById(focus.toLowerCase())?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    return () => clearTimeout(id);
  }, [focus, securities]);

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
      <div className="eyebrow">{t("Transparency")}</div>
      <h1 className="display mt-2 text-[clamp(1.8rem,5vw,3.2rem)]">{t("Every share, accounted for.")}</h1>
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
          {t("No securities have been issued yet.")}
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
                id={s.symbol.toLowerCase()}
                className={`scroll-mt-28 rounded-3xl border p-5 sm:p-7 ${
                  under ? "border-[var(--color-down)]/50 bg-[var(--color-down)]/[0.05]" : "hairline"
                } ${focus === s.symbol ? "ring-2 ring-[var(--color-accent)]" : ""}`}
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.03em]">
                        {s.symbol}
                      </h2>
                      <span className="rounded-full surface px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                        {s.status}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-sm text-[var(--muted)]">{s.name}</p>
                  </div>
                  <div className="sm:text-right">
                    <div className="eyebrow">Backing</div>
                    <div className={`tnum text-3xl font-medium ${
                      under ? "text-[var(--color-down)]" : "text-[var(--color-up)]"
                    }`}>
                      {b.ratioPct === null ? "—" : `${b.ratioPct.toFixed(2)}%`}
                    </div>
                  </div>
                </div>

                {/*
                  * An odd number of cells leaves a hole, and the grid's own
                  * background shows through it as a grey block that looks like
                  * a figure failed to load. The last cell spans the row when
                  * there is nothing to pair it with.
                  */}
                {/*
                  * An external listing is backed by a balance, not a statement.
                  *
                  * There is no custodian attestation to show: CAPX bought the
                  * issuer's token and holds it, so what matters is how much it
                  * holds against what customers are owed — both readable on
                  * Base by anyone.
                  */}
                {s.kind === "external" ? (
                  <>
                    <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-3">
                      <Cell label={t("Held by CAPX")} value={(s.held ?? b.underlying).toLocaleString()} />
                      <Cell label={t("Held by customers")} value={b.clientHeld.toLocaleString()} />
                      <Cell label={t("Available to buy")} value={Math.max(0, (s.held ?? 0) - b.clientHeld).toLocaleString()} />
                    </div>
                    <dl className="mt-4 grid min-w-0 gap-1.5 text-[13px] sm:grid-cols-2">
                      <Row k={t("Token issued by")} v={s.issuer ?? "—"} />
                      <Row k={t("Selling")} v={s.buyOnly ? t("Opens when the offer closes") : t("Open")} warn={s.buyOnly} />
                      <Row
                        k="Token"
                        v={s.token_address ? `${s.token_address.slice(0, 10)}…${s.token_address.slice(-6)}` : "—"}
                      />
                    </dl>
                    <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
                      {t("CAPX buys this token and holds it. The balance above is read from Base, and customers' claims are recorded in CAPX's ledger.")}
                    </p>
                  </>
                ) : (
                  <>
                <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
                  <Cell label={t("Underlying shares")} value={b.underlying.toLocaleString()} />
                  <Cell label={t("Locked in custody")} value={b.locked.toLocaleString()} />
                  <Cell label={t("Tokens outstanding")} value={b.issued.toLocaleString()} />
                  {/* Buying does not mint and selling does not burn, so this is
                      the figure that explains why tokens outstanding sits still
                      while the tradable pool moves. */}
                  <Cell label={t("Held by customers")} value={b.clientHeld.toLocaleString()} />
                  <Cell label={t("Available to buy")} value={b.unallocated.toLocaleString()} />
                </div>

                <dl className="mt-4 grid min-w-0 gap-1.5 text-[13px] sm:grid-cols-2">
                  <Row k="Custodian" v={b.custodian ?? "Not yet attested"} />
                  <Row k="Last verified" v={dt(b.lastVerified)} />
                  <Row
                    k="Attestation expires"
                    v={b.fresh ? dt(b.expiresAt) : "Expired. Issuance is halted"}
                    warn={!b.fresh}
                  />
                  <Row
                    k="Token"
                    v={s.token_address ? `${s.token_address.slice(0, 10)}…${s.token_address.slice(-6)}` : "Not deployed"}
                  />
                </dl>
                  </>
                )}

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
    <div className="min-w-0 bg-[var(--bg)] px-3 py-3 sm:px-4">
      {/* Tracking comes off on a phone: letter-spacing on an uppercase label is
          what turned "Locked in custody" into a 190px column. */}
      <div className="eyebrow leading-tight tracking-[0.08em] sm:tracking-[0.16em]">{label}</div>
      <div className="tnum mt-1.5 text-base font-medium sm:text-lg">{value}</div>
    </div>
  );
}

/**
 * A label and its value.
 *
 * Stacked on a phone, side by side once there is room. It used to be side by
 * side always, with the value set to truncate — and `truncate` implies
 * `white-space: nowrap`, so the row's minimum width became the full length of
 * the longest value. A custodian called "CAPX self-declared - custodian
 * statement pending" gave the row a 546px floor on a 375px screen, and the
 * whole card was dragged past the edge of the viewport.
 *
 * The value wraps now rather than truncating, because the custodian's name is
 * the one thing this row exists to say and an ellipsis would hide exactly the
 * part worth reading. `min-w-0` lets the row shrink as a grid item; without it
 * the wrapping alone would not be enough.
 */
function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="min-w-0 border-b hairline py-1.5 last:border-0 sm:flex sm:items-baseline sm:justify-between sm:gap-3">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--muted)] sm:text-[13px] sm:normal-case sm:tracking-normal">
        {k}
      </dt>
      <dd className={`tnum mt-0.5 min-w-0 break-words sm:mt-0 sm:text-right ${
        warn ? "text-[var(--color-down)]" : ""}`}>
        {v}
      </dd>
    </div>
  );
}
