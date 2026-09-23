"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useIssuer, IssuerBar, predictToken, createTokenTx, tokenAbi, registryAbi, MINT_ROLE, BURN_ROLE,
} from "./IssuerWallet";
import type { Abi } from "viem";

type Backing = {
  security: string; custodian: string | null;
  underlying: number; locked: number; issued: number;
  recorded: number; drift: number; source: "chain" | "ledger";
  custodySource: "chain" | "filed" | "none"; custodyMismatch: string | null;
  ratioPct: number | null; headroom: number;
  /** Tokens customers hold claims on, and the rest — the only part that can be burned. */
  clientHeld?: number; unallocated?: number;
  fresh: boolean; expiresAt: string | null; lastVerified: string | null;
};
type Security = {
  symbol: string; name: string; token_address: string | null; decimals: number; status: string;
  has_logo?: boolean; backing: Backing;
  /** "dse" — CAPX tokenised it; "external" — someone else's token, bought and held. */
  kind?: "dse" | "external"; issuer?: string | null; venue?: string | null; buyOnly?: boolean;
  /** For an external listing: what the treasury holds and what customers are owed. */
  held?: number; clientHeld?: number;
};
type Role = "admin" | "fimco";
type Request_ = {
  id: string; security: string; kind: "mint" | "burn"; quantity: number; note: string | null;
  requested_by: string; status: string; decided_by: string | null; tx_hash: string | null; created_at: string;
};
type Contracts = { custodyRegistry: string; treasury: string | null };
type DeskData = {
  role: Role; securities: Security[]; attestations: Attestation[]; issuance: Issuance[];
  requests: Request_[]; contracts: Contracts;
};

/** Who holds this security, from the same route the admin holdings tab uses. */
type Holder = {
  userId: string; email: string; name: string | null; username: string | null;
  kycStatus: string; asset: string; qty: number; trades: number;
  firstBought: string | null; lastTrade: string | null;
  avgCost: number; realised: number; currency: "USD" | "TZS";
};
type Attestation = {
  id: string; security: string; custodian: string; quantity: number; locked: number;
  doc_ref: string | null; issued_at: string; expires_at: string;
  status: string; approved_by: string | null; filed_by: string | null; expired: boolean;
  /** Whether a pledge or statement was attached, and what it is called. */
  hasDocument?: boolean; documentName?: string | null;
};
type Issuance = { id: string; security: string; kind: string; quantity: number; tx_hash: string | null; created_at: string };

/** What each desk action tells the operator when it succeeds. */
const DONE: Record<string, string> = {
  "attest": "Filed. It now waits for CAPX to approve and tokenise it.",
  "approve-attestation": "Attestation approved. Publish it on-chain to open headroom.",
  "reject-attestation": "Attestation rejected.",
  "request-issuance": "Mint requested. It now waits for CAPX approval.",
  "approve-request": "Request approved. Mint it with the issuer wallet.",
  "reject-request": "Request rejected.",
  "complete-request": "Mint confirmed on Base and recorded. The new shares are available.",
  "execute-burn": "Burned on Base and recorded. Supply is lower by that amount.",
  "register-security": "Saved.",
  "reconcile": "Recorded the on-chain supply.",
};

const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * The custody desk: what a custodian says it holds, and what may be issued
 * against it.
 *
 * Deliberately not a form that mints. Filing an attestation, approving it and
 * issuing against it are three steps, because approval is the moment CAPX
 * asserts the shares are really in the vault — and that should be a decision
 * somebody makes, not a side effect of typing numbers into a box.
 */
export function SecuritiesDesk({ portal = "desk" }: { portal?: "desk" | "fimco" }) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<DeskData | null>(null);
  const [busy, setBusy] = useState(false);
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (t: string) => {
    if (!t) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/custody?token=${encodeURIComponent(t)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.code === "unauthorised" ? "That token was not accepted." : j.error);
      setData({
        role: j.role === "fimco" ? "fimco" : "admin",
        securities: j.securities ?? [], attestations: j.attestations ?? [], issuance: j.issuance ?? [],
        requests: j.requests ?? [], contracts: j.contracts ?? { custodyRegistry: "", treasury: null },
      });

      /*
       * Who actually holds it, from the same route the admin holdings tab
       * reads. A backing ratio says the position is covered; it does not say
       * whose it is, and the desk deciding whether to mint more should be able
       * to see both on one screen.
       */
      const h = await fetch(`/api/admin/holders?token=${encodeURIComponent(t)}`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);
      setHolders(h?.ok ? h.holders : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load");
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!data || !token) return;
    const id = setInterval(() => void load(token), 30_000);
    return () => clearInterval(id);
  }, [data, token, load]);

  /* Success toasts auto-clear; errors stay until dismissed, since they need reading. */
  useEffect(() => {
    if (!note || err) return;
    const id = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(id);
  }, [note, err]);

  /** Runs a desk action; resolves true when it succeeded. */
  const act = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/admin/custody", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      // A refused mint is the backing rule working, so it reads as a result
      // rather than a failure.
      if (!j.ok) throw new Error(j.error ?? "Action failed");
      setNote(body.action === "register-security" && body.status === "live" && body.symbol
        ? `${body.symbol} is live. Customers can now see and buy it.`
        : DONE[String(body.action)] ?? "Done.");
      await load(token);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const [editing, setEditing] = useState<Security | null>(null);

  /*
   * Approve & tokenise: the whole of CAPX's side of a filing in one press.
   *
   * Approving, publishing to the registry and minting were three buttons in
   * three places, and FIMCO's filing is already the evidence all three rest
   * on. The mint is the gap between what the filing locks and what exists
   * on-chain, read from the chain at the moment of minting — so a top-up
   * filing of 1,100 against 100 in circulation mints exactly 1,000, and a
   * filing that adds nothing mints nothing.
   */
  const tokenise = (a: Attestation) => sign(`Tokenise ${a.security}`, async () => {
    const sec = data?.securities.find((x) => x.symbol === a.security);
    const token = sec?.token_address as `0x${string}` | undefined;
    const treasury = data?.contracts.treasury as `0x${string}` | null | undefined;
    if (!sec || !token) throw new Error(`Create ${a.security}t on its card first, then approve.`);
    if (!treasury || !w.client) throw new Error("No treasury or chain connection to mint into.");

    if (a.status === "pending" && !(await act({ action: "approve-attestation", id: a.id }))) {
      throw new Error("The approval did not go through.");
    }
    await w.send({
      address: data!.contracts.custodyRegistry as `0x${string}`, abi: registryAbi as Abi, functionName: "attestCustody",
      args: [a.security, a.custodian, BigInt(Math.round(a.quantity)), BigInt(Math.round(a.locked)),
             BigInt(Math.floor(new Date(a.expires_at).getTime() / 1000)), a.doc_ref ?? ""],
    });
    const supply = await w.client.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply" }) as bigint;
    const target = BigInt(baseUnits(a.locked, sec.decimals));
    const gap = target - supply;
    if (gap <= 0n) return `${a.security}: attestation approved and published. Supply already covers it, so nothing was minted.`;
    const hash = await w.send({ address: token, abi: tokenAbi as Abi, functionName: "mint", args: [treasury, gap] });
    await act({ action: "reconcile", security: a.security, txHash: hash });
    const minted = Number(gap) / 10 ** sec.decimals;
    return sec.status === "draft"
      ? `${a.security}: approved, published and ${minted.toLocaleString()} minted. Press Go live on its card when ready.`
      : `${a.security}: approved, published and ${minted.toLocaleString()} minted. They are available to buy now.`;
  });

  const isAdmin = data?.role === "admin";
  const w = useIssuer(data?.contracts.custodyRegistry ?? "");

  /** Runs a wallet-signed step with the desk's busy and error handling. */
  const sign = async (label: string, fn: () => Promise<void | string>) => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const msg = await fn();
      setNote(typeof msg === "string" ? msg : `${label}: done.`);
      await load(token);
    } catch (e) {
      const m = e as { shortMessage?: string; message?: string };
      setErr(`${label}: ${m.shortMessage ?? m.message ?? "failed"}`);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
        <div className="eyebrow">{portal === "fimco" ? "FIMCO · custody broker" : "Operations"}</div>
        <h1 className="display mt-3 text-3xl">{portal === "fimco" ? "Custody portal." : "Securities desk."}</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {portal === "fimco"
            ? "Holdings, attestations and tokenisation for the securities FIMCO holds for CAPX."
            : "Custody, issuance and the price feed."}
        </p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(token); }}
          type="password" placeholder={portal === "fimco" ? "Access token" : "Admin token"}
          className="mt-6 w-full rounded-xl border hairline bg-transparent px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          onClick={() => void load(token)} disabled={busy || !token}
          className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
        >
          {busy ? "Checking…" : "Open desk"}
        </button>
        {err && <p className="mt-3 text-xs text-[var(--color-down)]">{err}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 pt-6 sm:px-8 sm:pt-12">
      <div className="eyebrow">
        {portal === "fimco" ? "FIMCO · custody broker" : "Operations"}
        {data.role === "admin" && portal === "fimco" && " · viewing as CAPX"}
      </div>
      <h1 className="display mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">{portal === "fimco" ? "Custody portal." : "Securities desk."}</h1>
      <Pipeline />
      <ExportPanel token={token} />
      {isAdmin && <IssuerBar w={w} />}

      {/*
        * Results as a toast, pinned to the screen.
        *
        * They used to print at the top of the page, which is the one place
        * nobody is looking after pressing a button halfway down it — filings,
        * approvals and mints all went through with no visible answer.
        */}
      {(note || err) && (
        <div role="status" aria-live="polite"
          className="fixed inset-x-4 bottom-6 z-[80] mx-auto flex max-w-lg items-start gap-3 rounded-2xl border hairline bg-[var(--bg)] px-4 py-3 text-[13px] shadow-2xl shadow-black/15">
          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] text-white ${
            err ? "bg-[var(--color-down)]" : "bg-[var(--color-up)]"}`}>{err ? "!" : "✓"}</span>
          <span className={`min-w-0 flex-1 break-words ${err ? "text-[var(--color-down)]" : ""}`}>{err ?? note}</span>
          <button onClick={() => { setErr(null); setNote(null); }} aria-label="Dismiss"
            className="shrink-0 text-[var(--muted)] hover:text-[var(--fg)]">✕</button>
        </div>
      )}

      {/* Backing first: it is the number every other panel exists to justify. */}
      <section className="mt-8 grid gap-4">
        {data.securities.length === 0 && (
          <p className="rounded-3xl border hairline p-6 text-sm text-[var(--muted)]">
            No securities registered yet. Register one below to begin.
          </p>
        )}
        {data.securities.map((s) => {
          const b = s.backing;
          const owed = b.clientHeld ?? 0;
          const under = s.kind === "external"
            ? b.underlying < owed
            : b.ratioPct !== null && b.ratioPct < 100;
          return (
            <div key={s.symbol} className={`rounded-3xl border p-5 ${
              under ? "border-[var(--color-down)]/50 bg-[var(--color-down)]/[0.05]" : "hairline"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex items-center gap-3">
                  {s.has_logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/securities/logo?symbol=${encodeURIComponent(s.symbol)}`} alt=""
                      className="h-9 w-9 rounded-full border hairline object-cover" />
                  )}
                  <span>
                    <span className="text-xl font-medium">{s.symbol}</span>
                    <span className="ml-2 text-sm text-[var(--muted)]">{s.name}</span>
                    <button
                      onClick={() => {
                        setEditing(s);
                        requestAnimationFrame(() => document.getElementById("register-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                      }}
                      className="ml-3 rounded-full border hairline px-2.5 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      Edit
                    </button>
                  </span>
                </div>
                <div className={`text-2xl font-medium ${under ? "text-[var(--color-down)]" : "text-[var(--color-up)]"}`}>
                  {s.kind === "external"
                    ? (b.underlying >= owed ? "Covered" : `Short ${(owed - b.underlying).toLocaleString()}`)
                    : b.ratioPct === null ? "—" : <span className="tnum">{b.ratioPct.toFixed(2)}%</span>}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] sm:grid-cols-5">
                <Cell label="Underlying" value={b.underlying.toLocaleString()} />
                <Cell label="Locked" value={b.locked.toLocaleString()} />
                <Cell
                  label={b.source === "chain" ? "Issued (chain)" : "Issued (log)"}
                  value={b.issued.toLocaleString()}
                />
                <Cell label="Headroom" value={b.headroom.toLocaleString()} />
                <Cell
                  label="Attested by"
                  value={b.custodian
                    ? b.custodian.trim().toUpperCase().startsWith(PRIMARY_BROKER) ? `${b.custodian} · main broker` : b.custodian
                    : `Awaiting ${PRIMARY_BROKER}`}
                />
              </div>
              <p className="mt-3 text-[11px] text-[var(--muted)]">
                {b.fresh
                  ? `${b.custodySource === "chain" ? "On-chain attestation" : "Filed attestation (not yet published on-chain)"} in force until ${dt(b.expiresAt)}. Verified ${dt(b.lastVerified)}.`
                  : "No attestation in force. Issuance is blocked until one is approved."}
              </p>

              {/*
                * The log and the chain disagreeing is the one thing on this page
                * that cannot be left to a number nobody reads. Minting happens
                * with the issuer key, outside this app, so a gap here means a
                * mint was recorded and never executed, or executed and never
                * recorded — and both need a person, not a refresh.
                */}
              {b.custodyMismatch && (
                <p className="mt-2 rounded-xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/[0.06] px-3 py-2 text-[11px] text-[var(--color-down)]">
                  {b.custodyMismatch} The smaller figure is in force until they agree.
                </p>
              )}

              {b.drift !== 0 && (
                <p className="mt-2 rounded-xl border border-[var(--color-down)]/40 bg-[var(--color-down)]/[0.06] px-3 py-2 text-[11px] text-[var(--color-down)]">
                  {b.drift > 0
                    ? `${b.drift.toLocaleString()} more on-chain than the issuance log records. A mint happened that was never written down.`
                    : `${Math.abs(b.drift).toLocaleString()} recorded in the issuance log but not on-chain. A mint was logged and never executed.`}
                  {" "}Issuance is measured against the larger of the two until this is resolved.
                  {/*
                    * Only the direction the chain leads can be repaired here.
                    * The quantity comes from the chain, never from this button,
                    * so the most it can do is write down tokens that already
                    * exist. The other direction — logged but never minted — is
                    * a question about which record is wrong, and that needs a
                    * person rather than a default.
                    */}
                  {b.drift > 0 && isAdmin && (
                    <button
                      onClick={() => void act({ action: "reconcile", security: s.symbol })}
                      disabled={busy}
                      className="ml-2 rounded-full border border-current px-3 py-1 text-[11px] font-medium hover:opacity-70 disabled:opacity-40"
                    >
                      Record it
                    </button>
                  )}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <div className="w-full">
                  {/*
                    * The last step, said out loud.
                    *
                    * A backed, minted security sat invisible because it was
                    * still a draft, and nothing on the card said that going
                    * live was the one thing left to do.
                    */}
                  {s.status === "draft" && s.token_address && (s.kind === "external" ? (s.held ?? b.underlying) > 0 : b.issued > 0 && b.fresh) && (
                    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-up)]/40 bg-[var(--color-up)]/[0.06] px-3.5 py-2.5 text-[12px]">
                      <span className="flex-1">
                        <span className="font-medium">
                          {s.kind === "external"
                            ? `${s.symbol} is in the treasury and ready.`
                            : `${s.symbol} is backed and minted.`}
                        </span>{" "}
                        {isAdmin
                          ? "It is still a draft, so customers cannot see or buy it yet."
                          : "CAPX takes it live for customers."}
                      </span>
                      {isAdmin && (
                        <button
                          disabled={busy}
                          onClick={() => void act({
                            action: "register-security", symbol: s.symbol, name: s.name,
                            tokenAddress: s.token_address, status: "live",
                          })}
                          className="rounded-full bg-[var(--color-up)] px-4 py-1.5 font-medium text-white disabled:opacity-50"
                        >
                          Go live
                        </button>
                      )}
                    </div>
                  )}
                  {s.kind === "external" ? (
                    /*
                      * Bought, not minted.
                      *
                      * There is no attestation to approve and nothing to mint:
                      * CAPX buys this token at the issuer's venue and the
                      * treasury's balance is the backing. The desk says where
                      * to buy it and what is covered.
                      */
                    <div className="mb-3 rounded-xl surface p-3 text-[12px]">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>
                          <span className="text-[var(--muted)]">Held by CAPX</span>{" "}
                          <span className="tnum font-medium">{(s.held ?? b.underlying).toLocaleString()}</span>
                        </span>
                        <span>
                          <span className="text-[var(--muted)]">Owed to customers</span>{" "}
                          <span className="tnum font-medium">{(s.clientHeld ?? b.clientHeld ?? 0).toLocaleString()}</span>
                        </span>
                        {s.issuer && <span className="text-[var(--muted)]">Issued by {s.issuer}</span>}
                        {s.buyOnly && <span className="text-[#b45309]">buying only</span>}
                      </div>
                      <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                        {s.venue
                          ? `Buy more at: ${s.venue}. The treasury's balance is the backing, so it rises when CAPX buys.`
                          : "Backed by whatever the treasury holds; buy more at the issuer's venue."}
                      </p>
                    </div>
                  ) : (
                    <TokenSetup sec={s} isAdmin={isAdmin} w={w} sign={sign} onAct={act} busy={busy} treasury={data.contracts.treasury} />
                  )}
                  {s.token_address && (
                    <>
                      {isAdmin && s.kind !== "external" && b.headroom > 0 && (
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <button disabled={busy || !w.isIssuer}
                            title={!w.isIssuer ? "Connect the issuer wallet above" : undefined}
                            onClick={() => void sign(`Mint ${s.symbol}`, async () => {
                              const token = s.token_address as `0x${string}`;
                              const treasury = data.contracts.treasury as `0x${string}`;
                              const units = BigInt(baseUnits(b.headroom, s.decimals));
                              const hash = await w.send({ address: token, abi: tokenAbi as Abi, functionName: "mint", args: [treasury, units] });
                              await act({ action: "reconcile", security: s.symbol, txHash: hash });
                              return `${s.symbol}: ${b.headroom.toLocaleString()} minted and recorded.`;
                            })}
                            className="rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40">
                            Mint {b.headroom.toLocaleString()} now
                          </button>
                          <span className="text-[11px] text-[var(--muted)]">Custody covers {b.headroom.toLocaleString()} more than exist.</span>
                        </div>
                      )}
                      {!isAdmin && s.kind !== "external" && (
                        <p className="mb-2 text-[11px] text-[var(--muted)]">
                          To add shares, file an updated holding below with the new total. CAPX approves and mints the difference.
                        </p>
                      )}
                      {s.kind !== "external" && (
                        <RequestMint security={s.symbol} headroom={b.headroom} unallocated={b.unallocated ?? 0} hasToken onAct={act} busy={busy} burnOnly />
                      )}
                    </>
                  )}
                </div>

                {/*
                  * Status was set once at registration and never again, so
                  * everything stayed "draft" — including a security trading
                  * live with real money against it. It is a property of the
                  * security, so it belongs on the security rather than buried
                  * in the form that created it.
                  */}
                {isAdmin && <span className="ml-auto inline-flex overflow-hidden rounded-full border hairline text-[11px]">
                  {(["draft", "live", "suspended"] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => void act({
                        action: "register-security",
                        symbol: s.symbol, name: s.name,
                        tokenAddress: s.token_address, status: st,
                      })}
                      disabled={busy || s.status === st}
                      className={`px-3 py-1 capitalize transition-colors disabled:opacity-100 ${
                        s.status === st
                          ? st === "live" ? "bg-[var(--color-up)] text-white"
                            : st === "suspended" ? "bg-[var(--color-down)] text-white"
                            : "bg-[var(--fg)] text-[var(--bg)]"
                          : "hover:surface"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </span>}
              </div>

              {/* The holders of this security specifically, not every position
                  on the platform. */}
              {(() => {
                const mine = (holders ?? []).filter((h) => h.asset === s.symbol);
                if (!mine.length) return null;
                const fmt = (n: number, c: "USD" | "TZS") =>
                  c === "TZS" ? `${Math.round(n).toLocaleString()} TZS` : `$${n.toFixed(2)}`;
                return (
                  <div className="mt-4 overflow-hidden rounded-2xl border hairline">
                    <div className="flex items-center justify-between border-b hairline px-4 py-2.5">
                      <span className="eyebrow">Holders</span>
                      <span className="tnum text-[11px] text-[var(--muted)]">
                        {mine.length} · {mine.reduce((t, h) => t + h.qty, 0)
                          .toLocaleString("en-US", { maximumFractionDigits: 8 })} held
                      </span>
                    </div>
                    <div className="scroll-thin max-h-72 divide-y divide-[var(--border)] overflow-y-auto">
                      {mine.map((h) => (
                        <div key={h.userId} className="flex items-baseline gap-3 px-4 py-2.5 text-[12px]">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{h.username ? `@${h.username}` : h.email || h.name || "—"}</span>
                            <span className="block truncate text-[11px] text-[var(--muted)]">
                              {h.name ?? (h.email || "—")}
                              <span className={h.kycStatus === "approved" ? "" : " text-[#b45309]"}>
                                {" · "}{h.kycStatus === "approved" ? "verified" : h.kycStatus}
                              </span>
                            </span>
                          </span>
                          <span className="tnum shrink-0 text-right">
                            <span className="block">
                              {h.qty.toLocaleString("en-US", { maximumFractionDigits: 8 })}
                            </span>
                            <span className="block text-[11px] text-[var(--muted)]">
                              avg {h.avgCost > 0 ? fmt(h.avgCost, h.currency) : "—"}
                            </span>
                          </span>
                          <span className="tnum shrink-0 text-right text-[11px] text-[var(--muted)]">
                            <span className="block">
                              {h.firstBought
                                ? new Date(h.firstBought).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                                : "—"}
                            </span>
                            <span className="block">{h.trades} {h.trades === 1 ? "trade" : "trades"}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </section>

      <RequestsSection data={data} isAdmin={isAdmin} onAct={act} busy={busy} w={w} sign={sign} />

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div id="register-form">
          <RegisterSecurity key={editing?.symbol ?? "new"} onAct={act} busy={busy} w={w} sign={sign}
            asBroker={!isAdmin} preset={editing} onDone={() => setEditing(null)} />
        </div>
        <FileAttestation onAct={act} busy={busy} lockToBroker={!isAdmin}
          securities={data.securities.map((x) => x.symbol)} />
      </div>

      <NoticeContacts token={token} isAdmin={isAdmin} />

      {portal === "fimco" && <CustomersSection token={token} />}

      {isAdmin && <OracleAdmin token={token} busy={busy} setBusy={setBusy} setErr={setErr} setNote={setNote} />}

      <section className="mt-8">
        <div className="eyebrow mb-2">Attestations</div>
        <div className="overflow-hidden rounded-2xl border hairline">
          {data.attestations.length === 0 ? (
            <p className="p-5 text-center text-sm text-[var(--muted)]">Nothing filed yet.</p>
          ) : data.attestations.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-3 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {a.security} · {a.quantity.toLocaleString()} held, {a.locked.toLocaleString()} locked
                </span>
                <span className="block text-[11px] text-[var(--muted)]">
                  {a.custodian || "—"} · {a.doc_ref || "no reference"} · expires {dt(a.expires_at)}
                  {a.filed_by && ` · filed by ${a.filed_by}`}
                  {a.approved_by && a.status === "approved" && ` · approved by ${a.approved_by}`}
                  {a.expired && " · EXPIRED"}
                </span>
              </span>
              {a.hasDocument && (
                <button
                  onClick={() => void openAttestationDoc(token, a)}
                  className="rounded-full border hairline px-2.5 py-1 text-[11px] hover:surface"
                >
                  Statement
                </button>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                a.status === "approved" && !a.expired ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
                : a.status === "rejected" ? "bg-[var(--color-down)]/10 text-[var(--color-down)]"
                : "surface text-[var(--muted)]"}`}>
                {a.expired && a.status === "approved" ? "expired" : a.status}
              </span>
              {a.status === "pending" && !isAdmin && (
                <span className="text-[11px] text-[var(--muted)]">Awaiting CAPX approval</span>
              )}
              {a.status === "pending" && isAdmin && (
                <span className="flex gap-2">
                  <button onClick={() => void tokenise(a)} disabled={busy || !w.isIssuer}
                    title={!w.isIssuer ? "Connect the issuer wallet above" : undefined}
                    className="rounded-full bg-[var(--fg)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--bg)] disabled:opacity-40">
                    Approve &amp; tokenise
                  </button>
                  <button onClick={() => void act({ action: "approve-attestation", id: a.id })} disabled={busy}
                    className="rounded-full border hairline px-3 py-1.5 text-[12px] hover:surface disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => void act({ action: "reject-attestation", id: a.id })} disabled={busy}
                    className="rounded-full border hairline px-3 py-1.5 text-[12px] text-[var(--color-down)] hover:surface disabled:opacity-50">
                    Reject
                  </button>
                </span>
              )}
              {isAdmin && a.status === "approved" && !a.expired && !onRegistry(a, data.securities) && (
                <div className="w-full">
                  <p className="text-[11px] text-[#b45309]">
                    Approved but not yet on the registry, so it backs nothing yet. Publish it with the issuer key:
                  </p>
                  <button
                    disabled={busy || !w.isIssuer}
                    title={!w.isIssuer ? "Connect the issuer wallet above" : undefined}
                    onClick={() => void tokenise(a)}
                    className="mr-2 mt-2 rounded-full bg-[var(--fg)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--bg)] disabled:opacity-40"
                  >
                    Publish &amp; mint
                  </button>
                  <button
                    disabled={busy || !w.isIssuer}
                    title={!w.isIssuer ? "Connect the issuer wallet above" : undefined}
                    onClick={() => void sign(`Publish ${a.security} attestation`, async () => {
                      await w.send({
                        address: data.contracts.custodyRegistry as `0x${string}`, abi: registryAbi as Abi,
                        functionName: "attestCustody",
                        args: [a.security, a.custodian, BigInt(Math.round(a.quantity)), BigInt(Math.round(a.locked)),
                               BigInt(Math.floor(new Date(a.expires_at).getTime() / 1000)), a.doc_ref ?? ""],
                      });
                    })}
                    className="mt-2 rounded-full bg-[var(--fg)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--bg)] disabled:opacity-40"
                  >
                    Publish only
                  </button>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-[var(--muted)]">Or run it with cast</summary>
                    <Cmd text={publishCmd(a, data.contracts.custodyRegistry)} />
                  </details>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="eyebrow mb-2">Issuance log</div>
        <div className="overflow-hidden rounded-2xl border hairline">
          {data.issuance.length === 0 ? (
            <p className="p-5 text-center text-sm text-[var(--muted)]">No mints or burns yet.</p>
          ) : data.issuance.map((i) => (
            <div key={i.id} className="flex items-center gap-3 border-b hairline px-4 py-2.5 last:border-0">
              <span className={`tnum w-16 text-sm font-medium ${
                i.kind === "mint" ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {i.kind === "mint" ? "+" : "−"}{i.quantity.toLocaleString()}
              </span>
              <span className="flex-1 text-sm">{i.security}</span>
              <span className="text-[11px] text-[var(--muted)]">{dt(i.created_at)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type Kyc = {
  id: string; user_id: string; email: string; name: string | null;
  doc_type: string; doc_number: string | null; status: string; reason: string | null;
  reviewed_by: string | null; reviewed_at: string | null; created_at: string;
  doc_bytes: number | null; selfie_bytes: number | null; doc_mime: string | null;
};



type AdminUser = {
  id: string; email: string; name: string | null; phone: string | null; nida_number: string | null;
  kyc_status: string; created_at: string; deposits: number; settled_tzs: number;
};
type AdminOrder = {
  id: string; side: string; symbol: string; qty: string | null; price: string | null;
  usdc_amount: string | null; status: string; created_at: string; email: string;
};
type AdminWithdrawal = { id: string; amount: string; ref: string | null; created_at: string; email: string };

/**
 * The client-facing records, as the tabs a broker actually works in.
 *
 * FIMCO had verifications and nothing else, so answering "what did this
 * customer trade" meant asking CAPX. These are the same records the CAPX desk
 * keeps — customers, orders, verifications, holdings, withdrawals — behind one
 * search that filters whichever tab is open.
 */
/**
 * Where CAPX's decisions are sent.
 *
 * FIMCO keeps this themselves: they read the mail, and a list only CAPX can
 * edit is a list that goes stale the first time somebody joins their desk.
 * CAPX can see it but has no reason to change it, so the field is theirs.
 */
function NoticeContacts({ token, isAdmin }: { token: string; isAdmin: boolean }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void fetch("/api/admin/contacts", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) { setSaved(j.emails); setValue(j.emails.join(", ")); } })
      .catch(() => { /* the save will say so */ });
  }, [token]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/contacts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ emails: value }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not save");
      setSaved(j.emails); setValue(j.emails.join(", "));
      setMsg(j.emails.length
        ? `Saved. Decisions go to ${j.emails.length === 1 ? j.emails[0] : `${j.emails.length} addresses`}.`
        : "Saved. No addresses, so no email will be sent.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 rounded-3xl border hairline p-5">
      <div className="eyebrow">Email notices</div>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
        {isAdmin
          ? "Where FIMCO is told when CAPX approves or rejects a filing. They keep this themselves."
          : "Where we email you when CAPX approves or rejects an attestation or a mint. Separate several with commas."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !isAdmin) void save(); }}
          readOnly={isAdmin}
          placeholder="operations@fimco.co.tz, custody@fimco.co.tz"
          className="min-w-0 flex-1 rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] read-only:text-[var(--muted)]"
        />
        {!isAdmin && (
          <button onClick={() => void save()} disabled={busy}
            className="rounded-full bg-[var(--fg)] px-5 py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40">
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-[12px] text-[var(--muted)]">{msg}</p>}
      {!msg && saved?.length === 0 && (
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          {isAdmin ? "FIMCO has not added an address yet." : "No address yet, so nothing is emailed."}
        </p>
      )}
    </section>
  );
}

function CustomersSection({ token }: { token: string }) {
  const [tab, setTab] = useState<"users" | "orders" | "kyc" | "holdings" | "withdrawals">("users");
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ users: AdminUser[]; orders: AdminOrder[]; withdrawals: AdminWithdrawal[] } | null>(null);
  const [kyc, setKyc] = useState<Kyc[] | null>(null);
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const get = (url: string) =>
      fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
        .then((r) => r.json()).catch(() => null);
    void Promise.all([get("/api/admin"), get("/api/admin/kyc"), get("/api/admin/holders")])
      .then(([a, k, h]) => {
        if (!alive) return;
        setData(a?.ok
          ? { users: a.users ?? [], orders: a.orders ?? [], withdrawals: a.withdrawals ?? [] }
          : { users: [], orders: [], withdrawals: [] });
        setKyc(k?.ok ? k.submissions : []);
        setHolders(h?.ok ? h.holders : []);
      });
    return () => { alive = false; };
  }, [token]);

  const s = q.trim().toLowerCase();
  const hit = (...vals: (string | null | undefined)[]) => !s || vals.some((v) => v?.toLowerCase().includes(s));
  const users = (data?.users ?? []).filter((u) => hit(u.email, u.name, u.phone, u.nida_number));
  const orders = (data?.orders ?? []).filter((o) => hit(o.email, o.symbol, o.side, o.status));
  const kycRows = (kyc ?? []).filter((r) => hit(r.name, r.email, r.doc_number));
  const holdRows = (holders ?? []).filter((h) => hit(h.email, h.name, h.username, h.asset));
  const wdRows = (data?.withdrawals ?? []).filter((w) => hit(w.email, w.ref));

  const tabs = [
    ["users", "Users", users.length],
    ["orders", "Orders", orders.length],
    ["kyc", "KYC", kycRows.length],
    ["holdings", "Holdings", holdRows.length],
    ["withdrawals", "Withdrawals", wdRows.length],
  ] as const;

  const img = (id: string, which: "doc" | "selfie") =>
    `/api/admin/kyc/image?id=${id}&which=${which}&token=${encodeURIComponent(token)}`;
  const money = (n: number, c = "TZS") => `${Math.round(n).toLocaleString()} ${c}`;
  const loading = !data || kyc === null || holders === null;

  return (
    <section className="mt-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow">Customers</div>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, ID number or security"
          className="w-72 max-w-full rounded-full border hairline bg-transparent px-3.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]" />
      </div>

      <div className="scroll-thin -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => { setTab(k); setOpen(null); }}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              tab === k ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"}`}>
            {label} <span className="tnum opacity-60">{n}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border hairline">
        {loading ? (
          <p className="p-5 text-center text-sm text-[var(--muted)]">Loading…</p>
        ) : tab === "users" ? (
          users.length === 0 ? <Empty q={q} what="customers" /> : users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-3 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{u.name ?? u.email}</span>
                <span className="block truncate text-[11px] text-[var(--muted)]">
                  {u.email}{u.phone ? ` · ${u.phone}` : ""}{u.nida_number ? ` · ${u.nida_number}` : ""}
                </span>
              </span>
              <span className="tnum shrink-0 text-right text-[11px] text-[var(--muted)]">
                <span className="block">{u.deposits} deposits · {money(Number(u.settled_tzs))}</span>
                <span className="block">joined {dt(u.created_at)}</span>
              </span>
              <KycTag status={u.kyc_status} />
            </div>
          ))
        ) : tab === "orders" ? (
          orders.length === 0 ? <Empty q={q} what="orders" /> : orders.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-2.5 text-[12px] last:border-0">
              <span className={`w-10 shrink-0 font-medium ${o.side === "buy" ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                {o.side === "buy" ? "Buy" : "Sell"}
              </span>
              <span className="w-16 shrink-0 font-medium">{o.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{o.email}</span>
              <span className="tnum shrink-0">
                {o.qty && Number(o.qty) > 0
                  ? `${Number(o.qty).toLocaleString("en-US", { maximumFractionDigits: 8 })}${
                      o.price && Number(o.price) > 0 ? ` @ ${Number(o.price).toLocaleString()} TZS` : ""}`
                  : o.usdc_amount ? `$${Number(o.usdc_amount).toFixed(2)}` : "—"}
              </span>
              <span className={`shrink-0 text-[11px] ${
                o.status === "settled" ? "text-[var(--muted)]" : "text-[var(--color-down)]"}`}>{o.status}</span>
              <span className="shrink-0 text-[11px] text-[var(--muted)]">{dt(o.created_at)}</span>
            </div>
          ))
        ) : tab === "holdings" ? (
          holdRows.length === 0 ? <Empty q={q} what="holdings" /> : holdRows.map((h) => (
            <div key={`${h.userId}-${h.asset}`} className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-2.5 text-[12px] last:border-0">
              <span className="w-16 shrink-0 font-medium">{h.asset}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="block truncate">{h.name ?? h.email}</span>
                <span className="block truncate text-[11px] text-[var(--muted)]">{h.email}</span>
              </span>
              <span className="tnum shrink-0 text-right">
                <span className="block">{h.qty.toLocaleString("en-US", { maximumFractionDigits: 8 })}</span>
                <span className="block text-[11px] text-[var(--muted)]">
                  {h.avgCost > 0 ? `avg ${money(h.avgCost, h.currency === "TZS" ? "TZS" : "USD")}` : "—"}
                  {" · "}{h.trades} {h.trades === 1 ? "trade" : "trades"}
                </span>
              </span>
            </div>
          ))
        ) : tab === "withdrawals" ? (
          wdRows.length === 0 ? <Empty q={q} what="withdrawals" /> : wdRows.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-2.5 text-[12px] last:border-0">
              <span className="min-w-0 flex-1 truncate">{w.email}</span>
              <span className="tnum shrink-0">{Math.abs(Number(w.amount)).toLocaleString()} TZS</span>
              <span className="shrink-0 text-[11px] text-[var(--muted)]">{dt(w.created_at)}</span>
            </div>
          ))
        ) : (
          kycRows.length === 0 ? <Empty q={q} what="verifications" /> : kycRows.map((r) => (
            <div key={r.id} className="border-b hairline last:border-0">
              <button onClick={() => setOpen(open === r.id ? null : r.id)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:surface">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name ?? r.email}</span>
                  <span className="block truncate text-[11px] text-[var(--muted)]">
                    {r.email} · {r.doc_type.replace(/_/g, " ")} {r.doc_number ?? ""} · {dt(r.created_at)}
                  </span>
                </span>
                <KycTag status={r.status} />
              </button>
              {open === r.id && (
                <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
                  {r.doc_bytes ? (
                    r.doc_mime === "application/pdf" ? (
                      <iframe src={img(r.id, "doc")} title="ID document"
                        className="h-[420px] w-full rounded-xl border hairline bg-white" />
                    ) : /heic|heif/i.test(r.doc_mime ?? "") ? (
                      <a href={img(r.id, "doc")} target="_blank" rel="noreferrer"
                        className="grid h-40 place-items-center rounded-xl border hairline surface text-center text-[12px] text-[var(--muted)]">
                        HEIC photo — <span className="underline">open it ↗</span>
                      </a>
                    ) : (
                      <a href={img(r.id, "doc")} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img(r.id, "doc")} alt="ID document"
                          className="max-h-[420px] w-full rounded-xl border hairline object-contain" />
                      </a>
                    )
                  ) : <p className="text-[11px] text-[var(--muted)]">No document image.</p>}
                  {r.selfie_bytes ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img(r.id, "selfie")} alt="Selfie"
                      className="max-h-[420px] w-full rounded-xl border hairline object-contain" />
                  ) : <p className="text-[11px] text-[var(--muted)]">No selfie.</p>}
                  <p className="text-[11px] text-[var(--muted)] sm:col-span-2">
                    {r.reviewed_by ? `Reviewed by ${r.reviewed_by} on ${dt(r.reviewed_at)}.` : "Awaiting review by CAPX."}
                    {r.reason && ` Reason: ${r.reason}`}
                  </p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Empty({ q, what }: { q: string; what: string }) {
  return <p className="p-5 text-center text-sm text-[var(--muted)]">No {what}{q ? " match" : " yet"}.</p>;
}

function KycTag({ status }: { status: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${
      status === "approved" ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
      : status === "rejected" ? "bg-[var(--color-down)]/10 text-[var(--color-down)]"
      : "surface text-[var(--muted)]"}`}>
      {status}
    </span>
  );
}

/** The dates a period preset stands for, worked out when the button is pressed. */
function exportRange(preset: string, from: string, to: string): { from?: string; to?: string } {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const now = new Date();
  if (preset === "30d") return { from: d(new Date(now.getTime() - 30 * 86400_000)), to: d(now) };
  if (preset === "month") return { from: d(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: d(now) };
  if (preset === "year") return { from: d(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: d(now) };
  if (preset === "custom") return { from: from || undefined, to: to || undefined };
  return {};
}

const EXPORTS: { key: string; label: string; about: string; ranged: boolean }[] = [
  { key: "customers", label: "Customers", about: "Identity, verification, funding, trading frequency, holdings", ranged: false },
  { key: "holdings", label: "Holdings", about: "Every position: quantity, cost, value, profit", ranged: false },
  { key: "trades", label: "Trades", about: "Every order: who, what, price, fee, cash", ranged: true },
  { key: "cash", label: "Deposits & withdrawals", about: "Method, amount, status, references", ranged: true },
  { key: "ledger", label: "Full ledger", about: "Every entry, unaggregated", ranged: true },
  { key: "attestations", label: "Custody filings", about: "Filed, approved, validity", ranged: true },
  { key: "issuance", label: "Mints & burns", about: "With Basescan links", ranged: true },
];

/**
 * Exports for both desks, as CSV that opens directly in Excel or Sheets.
 *
 * Fetched with the token in a header and saved from a blob, rather than a
 * plain link with ?token=, so the token never lands in browser history or a
 * download manager's URL list.
 */
function ExportPanel({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<"all" | "30d" | "month" | "year" | "custom">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);


  const download = async (key: string) => {
    const r = exportRange(preset, from, to);
    const q = new URLSearchParams({ dataset: key, ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) });
    const res = await fetch(`/api/admin/export?${q}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.error ?? `Export failed (${res.status})`);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `capx_${key}.csv`;
    const rows = Number(res.headers.get("x-row-count") ?? 0);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return rows;
  };

  const one = async (key: string, label: string) => {
    setBusyKey(key); setMsg(null);
    try { const n = await download(key); setMsg(`${label}: ${n.toLocaleString()} rows downloaded.`); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Export failed"); }
    finally { setBusyKey(null); }
  };
  const all = async () => {
    setBusyKey("all"); setMsg(null);
    try {
      let total = 0;
      for (const x of EXPORTS) { total += await download(x.key); await new Promise((r) => setTimeout(r, 350)); }
      setMsg(`${EXPORTS.length} files, ${total.toLocaleString()} rows downloaded.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Export failed"); }
    finally { setBusyKey(null); }
  };

  return (
    <section className="mt-4 rounded-2xl border hairline">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span>
          <span className="eyebrow">Export data</span>
          <span className="ml-3 text-[12px] text-[var(--muted)]">Customers, holdings, trades, cash, filings — as spreadsheets</span>
        </span>
        <span className="text-[var(--muted)]">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t hairline px-4 pb-4 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-[var(--muted)]">Period</span>
            {([["all", "All time"], ["30d", "Last 30 days"], ["month", "This month"], ["year", "This year"], ["custom", "Custom"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setPreset(k)}
                className={`rounded-full border px-3 py-1 ${preset === k ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"}`}>
                {l}
              </button>
            ))}
            {preset === "custom" && (
              <span className="flex items-center gap-1.5">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="rounded-lg border hairline bg-transparent px-2 py-1" />
                <span className="text-[var(--muted)]">to</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  className="rounded-lg border hairline bg-transparent px-2 py-1" />
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            The period applies to trades, cash, ledger, filings and mints. Customers and holdings are always as of now, with lifetime totals.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {EXPORTS.map((x) => (
              <button key={x.key} disabled={!!busyKey} onClick={() => void one(x.key, x.label)}
                className="rounded-xl border hairline p-3 text-left transition-colors hover:surface disabled:opacity-50">
                <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
                  {x.label}
                  <span className="text-[11px] font-normal text-[var(--muted)]">{busyKey === x.key ? "Preparing…" : "CSV ↓"}</span>
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-[var(--muted)]">
                  {x.about}{!x.ranged && " · as of now"}
                </span>
              </button>
            ))}
            <button disabled={!!busyKey} onClick={() => void all()}
              className="rounded-xl bg-[var(--fg)] p-3 text-left text-[var(--bg)] disabled:opacity-50">
              <span className="block text-[13px] font-medium">{busyKey === "all" ? "Preparing…" : "Download all"}</span>
              <span className="mt-1 block text-[11px] opacity-70">Every table above, one file each</span>
            </button>
          </div>
          {msg && <p className="mt-3 text-[12px] text-[var(--muted)]">{msg}</p>}
        </div>
      )}
    </section>
  );
}

/**
 * The route from shares in custody to tokens in circulation.
 *
 * Shown at the top because the desk is used by two parties and each of them
 * needs to know whose move it is. FIMCO confirms what it holds; CAPX approves
 * and publishes that on-chain; only then is there headroom, and only a mint
 * inside that headroom can be requested, approved and executed.
 */
function Pipeline() {
  const steps: [string, string, string][] = [
    ["1", "FIMCO lists", "The company, its logo and the shares held, with the statement reference — one form."],
    ["2", "CAPX creates the token", "Once per company, from its card, with the issuer wallet."],
    ["3", "Approve & tokenise", "One press: approves, publishes on-chain and mints exactly what the filing adds."],
    ["4", "Go live", "Customers can see and buy it. Adding shares later is an updated filing, then step 3."],  ];
  return (
    <div className="mt-6 grid gap-px overflow-hidden rounded-2xl border hairline bg-[var(--border)] sm:grid-cols-4">
      {steps.map(([n, title, body]) => (
        <div key={n} className="bg-[var(--bg)] p-3.5">
          <div className="tnum text-[11px] text-[var(--muted)]">{n}</div>
          <div className="mt-1 text-[13px] font-medium">{title}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">{body}</div>
        </div>
      ))}
    </div>
  );
}

/** A shell command to run with the issuer key, with a copy button. */
function Cmd({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-start gap-2 rounded-xl surface p-3">
      <pre className="scroll-thin min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">{text}</pre>
      <button
        onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        className="shrink-0 rounded-full border hairline px-2.5 py-1 text-[11px] hover:bg-[var(--bg)]"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const shq = (v: string) => `"${v.replace(/(["\\$`])/g, "\\$1")}"`;
const RUN_FROM = "cd contracts && source .env && \\\n";

/**
 * Whether an approved filing is what the registry actually says.
 *
 * Backing takes the smaller of the filed and on-chain figures, so a filing
 * that matches backing exactly with the chain as its source is the one that
 * is live. Anything else still needs publishing.
 */
function onRegistry(a: Attestation, securities: Security[]) {
  const b = securities.find((x) => x.symbol === a.security)?.backing;
  return !!b && b.custodySource === "chain" && b.underlying === a.quantity && b.locked === a.locked;
}

function publishCmd(a: Attestation, registry: string) {
  const expiry = Math.floor(new Date(a.expires_at).getTime() / 1000);
  return RUN_FROM + `cast send ${registry} \\\n  "attestCustody(string,string,uint256,uint256,uint64,string)" \\\n  ` +
    `${shq(a.security)} ${shq(a.custodian)} ${a.quantity} ${a.locked} ${expiry} ${shq(a.doc_ref ?? "")} \\\n` +
    `  --private-key $ISSUER_PRIVATE_KEY --rpc-url $BASE_MAINNET_RPC`;
}

/** Whole-share quantity to token base units, as a string so nothing rounds. */
function baseUnits(qty: number, decimals: number) {
  const [w, f = ""] = String(qty).split(".");
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}

function mintCmd(r: Request_, sec: Security | undefined, treasury: string | null) {
  if (!sec?.token_address) return null;
  if (!treasury) return null;
  return RUN_FROM + `cast send ${sec.token_address} "mint(address,uint256)" \\\n  ${treasury} ${baseUnits(r.quantity, sec.decimals)} \\\n` +
    `  --private-key $ISSUER_PRIVATE_KEY --rpc-url $BASE_MAINNET_RPC`;
}

/**
 * Getting a security its token, one step at a time, read from the chain.
 *
 * Creating a token is three things — the factory call, linking the address to
 * the security here, and granting the issuer the mint role — and two of them
 * need a signature. Run as one button, a dismissed or failed second signature
 * left a token on Base that the desk knew nothing about. Each step is now its
 * own, derived from what the chain actually says, so an interrupted setup
 * picks up where it stopped rather than starting again.
 */
function TokenSetup({ sec, isAdmin, w, sign, onAct, busy, treasury }: {
  sec: Security; isAdmin: boolean; w: ReturnType<typeof useIssuer>; treasury: string | null;
  sign: (label: string, fn: () => Promise<void | string>) => Promise<void>;
  onAct: (b: Record<string, unknown>) => Promise<boolean | void>; busy: boolean;
}) {
  const tsym = `${sec.symbol}t`;
  const [state, setState] = useState<{ address: `0x${string}`; exists: boolean; minter: boolean; burner: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const issuer = w.issuer as `0x${string}` | null;

  useEffect(() => {
    if (!w.client || !issuer) return;
    let alive = true;
    (async () => {
      // A linked token is the one to check; otherwise the address the factory
      // would give this symbol, which is where an interrupted create landed.
      const predicted = sec.token_address
        ? { address: sec.token_address as `0x${string}`, exists: true }
        : await predictToken(w.client!, issuer, tsym);
      const minter = predicted.exists
        ? Boolean(await w.client!.readContract({
            address: predicted.address, abi: tokenAbi, functionName: "hasRole", args: [MINT_ROLE, issuer],
          }).catch(() => false))
        : false;
      // Burning is done by the treasury, which holds the tokens, so it is the
      // treasury that needs the burn role.
      const burner = predicted.exists && treasury
        ? Boolean(await w.client!.readContract({
            address: predicted.address, abi: tokenAbi, functionName: "hasRole", args: [BURN_ROLE, treasury as `0x${string}`],
          }).catch(() => false))
        : false;
      if (alive) setState({ ...predicted, minter, burner });
    })().catch(() => {});
    return () => { alive = false; };
  }, [w.client, issuer, sec.token_address, tsym, tick, treasury]);

  const link = (address: string) =>
    onAct({ action: "register-security", symbol: sec.symbol, name: sec.name, tokenAddress: address, status: sec.status, decimals: 8 });

  const linked = !!sec.token_address;
  const done = linked && state?.minter;
  if (done) {
    return (
      <p className="mb-2 text-[11px] text-[var(--muted)]">
        <span className="text-[var(--color-up)]">✓ Token ready</span> · {tsym}{" "}
        <a href={`https://basescan.org/token/${sec.token_address}`} target="_blank" rel="noreferrer"
          className="tnum underline underline-offset-2">{sec.token_address!.slice(0, 8)}…{sec.token_address!.slice(-4)}</a> · mint role granted
        {" · "}
        {state?.burner ? "burning enabled" : isAdmin ? (
          <button disabled={busy || !w.isIssuer || !treasury}
            title={!w.isIssuer ? "Connect the issuer wallet above" : undefined}
            onClick={() => void sign(`Enable burning on ${tsym}`, async () => {
              await w.send({ address: state!.address, abi: tokenAbi as Abi, functionName: "grantRole", args: [BURN_ROLE, treasury as `0x${string}`] });
              setTick((t) => t + 1);
            })}
            className="underline underline-offset-2 disabled:opacity-50">
            enable burning
          </button>
        ) : "burning not enabled"}
      </p>
    );
  }
  if (!isAdmin) {
    return (
      <p className="mb-2 text-[11px] text-[var(--muted)]">
        {linked ? `${tsym} is linked; CAPX is finishing its setup.` : `Waiting for CAPX to create ${tsym} on Base.`}
      </p>
    );
  }

  const steps: [string, boolean][] = [
    [`Create ${tsym}`, !!state?.exists],
    [`Link to ${sec.symbol}`, linked],
    ["Grant mint role", !!state?.minter],
  ];
  const needWallet = !w.isIssuer;
  return (
    <div className="mb-3 rounded-xl surface p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {steps.map(([label, ok], i) => (
          <span key={label} className={ok ? "text-[var(--color-up)]" : "text-[var(--muted)]"}>
            {ok ? "✓" : `${i + 1}.`} {label}
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {!state ? (
          <span className="text-[var(--muted)]">{issuer ? "Checking Base…" : "Reading the issuer from the registry…"}</span>
        ) : !state.exists ? (
          <button disabled={busy || needWallet} title={needWallet ? "Connect the issuer wallet above" : undefined}
            onClick={() => void sign(`Create ${tsym}`, async () => {
              await w.send(createTokenTx(sec.name, tsym, issuer!));
              // Linked at once, so a later step failing cannot orphan the token.
              await link(state.address);
            })}
            className="rounded-full bg-[var(--fg)] px-3.5 py-1.5 font-medium text-[var(--bg)] disabled:opacity-40">
            Create {tsym}
          </button>
        ) : !linked ? (
          <>
            <span>{tsym} exists at <span className="tnum">{state.address.slice(0, 8)}…{state.address.slice(-4)}</span>.</span>
            <button disabled={busy} onClick={() => void link(state.address)}
              className="rounded-full bg-[var(--fg)] px-3.5 py-1.5 font-medium text-[var(--bg)] disabled:opacity-40">
              Link it to {sec.symbol}
            </button>
          </>
        ) : (
          <>
            <span>Next, allow the issuer to mint {tsym}.</span>
            <button disabled={busy || needWallet} title={needWallet ? "Connect the issuer wallet above" : undefined}
              onClick={() => void sign(`Grant mint role on ${tsym}`, async () => {
                await w.send({ address: state.address, abi: tokenAbi as Abi, functionName: "grantRole", args: [MINT_ROLE, issuer!] });
                setTick((t) => t + 1);
              })}
              className="rounded-full bg-[var(--fg)] px-3.5 py-1.5 font-medium text-[var(--bg)] disabled:opacity-40">
              Grant mint role
            </button>
          </>
        )}
        {needWallet && state && !(linked && !state.exists) && (
          <span className="text-[11px] text-[var(--muted)]">Signing steps need the issuer wallet connected above.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Asking for more tokens.
 *
 * There is no bare "Mint" button any more. The old one only wrote a line in
 * the log — the tokens themselves need the issuer key — so it looked like
 * minting while doing nothing on-chain. A request goes into the queue below,
 * where it is approved and then closed against the real transaction.
 */
function RequestMint({ security, headroom, unallocated = 0, hasToken, onAct, busy, burnOnly = false }: {
  security: string; headroom: number; unallocated?: number; hasToken: boolean;
  /** Minting now follows an attestation; only burns are requested on their own. */
  burnOnly?: boolean;
  onAct: (b: Record<string, unknown>) => Promise<boolean | void>; busy: boolean;
}) {
  const [qty, setQty] = useState("");
  const n = Number(qty) || 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
        inputMode="decimal" placeholder="Shares"
        className="tnum w-28 rounded-xl border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
      {!burnOnly && <button
        onClick={() => { void onAct({ action: "request-issuance", security, kind: "mint", quantity: n }); setQty(""); }}
        disabled={busy || !(n > 0) || n > headroom || !hasToken}
        className="rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
      >
        Request mint
      </button>}
      {/* Burning retires inventory nobody owns — never shares a customer holds. */}
      <button
        onClick={() => { void onAct({ action: "request-issuance", security, kind: "burn", quantity: n }); setQty(""); }}
        disabled={busy || !(n > 0) || n > unallocated || !hasToken}
        title={n > unallocated ? `Only ${unallocated} are not held by customers` : undefined}
        className="rounded-full border hairline px-4 py-2 text-[13px] font-medium hover:surface disabled:opacity-40"
      >
        Request burn
      </button>
      <span className="text-[11px] text-[var(--muted)]">
        {burnOnly
          ? `Burnable: ${unallocated.toLocaleString()} — shares no customer holds. Burn when shares leave custody.`
          : <>
            {!hasToken
              ? "No token registered yet — create it and register its address first."
              : headroom > 0
                ? `Up to ${headroom.toLocaleString()} can be minted against current custody.`
                : "Headroom is 0: every locked share already has a token. To mint more, FIMCO files a larger attestation first."}
            {hasToken && ` Burnable: ${unallocated.toLocaleString()} (not held by customers).`}
          </>}
      </span>
    </div>
  );
}

/** The queue of mint and burn requests, and what each one is waiting for. */
function RequestsSection({ data, isAdmin, onAct, busy, w, sign }: {
  data: DeskData; isAdmin: boolean; onAct: (b: Record<string, unknown>) => Promise<boolean | void>; busy: boolean;
  w: ReturnType<typeof useIssuer>; sign: (label: string, fn: () => Promise<void | string>) => Promise<void>;
}) {
  const [hashes, setHashes] = useState<Record<string, string>>({});
  return (
    <section className="mt-8">
      <div className="eyebrow mb-2">Tokenisation requests</div>
      <div className="overflow-hidden rounded-2xl border hairline">
        {data.requests.length === 0 ? (
          <p className="p-5 text-center text-sm text-[var(--muted)]">No requests yet. Request a mint from a security above.</p>
        ) : data.requests.map((r) => {
          const sec = data.securities.find((x) => x.symbol === r.security);
          const cmd = r.status === "approved" && r.kind === "mint" ? mintCmd(r, sec, data.contracts.treasury) : null;
          return (
            <div key={r.id} className="border-b hairline px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {r.kind === "mint" ? "Mint" : "Burn"} {r.quantity.toLocaleString()} {r.security}
                  </span>
                  <span className="block text-[11px] text-[var(--muted)]">
                    Requested by {r.requested_by} · {dt(r.created_at)}
                    {r.decided_by && ` · ${r.status === "rejected" ? "rejected" : "approved"} by ${r.decided_by}`}
                    {r.note && ` · ${r.note}`}
                  </span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                  r.status === "executed" ? "bg-[var(--color-up)]/10 text-[var(--color-up)]"
                  : r.status === "rejected" ? "bg-[var(--color-down)]/10 text-[var(--color-down)]"
                  : "surface text-[var(--muted)]"}`}>
                  {r.status}
                </span>
                {r.status === "pending" && isAdmin && (
                  <span className="flex gap-2">
                    <button onClick={() => void onAct({ action: "approve-request", id: r.id })} disabled={busy}
                      className="rounded-full border hairline px-3 py-1.5 text-[12px] hover:surface disabled:opacity-50">Approve</button>
                    <button onClick={() => void onAct({ action: "reject-request", id: r.id })} disabled={busy}
                      className="rounded-full border hairline px-3 py-1.5 text-[12px] text-[var(--color-down)] hover:surface disabled:opacity-50">Reject</button>
                  </span>
                )}
                {r.status === "pending" && !isAdmin && (
                  <span className="text-[11px] text-[var(--muted)]">Awaiting CAPX approval</span>
                )}
                {r.status === "executed" && r.tx_hash && (
                  <a href={`https://basescan.org/tx/${r.tx_hash}`} target="_blank" rel="noreferrer"
                    className="tnum text-[11px] underline underline-offset-2">{r.tx_hash.slice(0, 10)}…</a>
                )}
              </div>
              {r.status === "approved" && isAdmin && r.kind === "burn" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button disabled={busy} onClick={() => void onAct({ action: "execute-burn", id: r.id })}
                    className="rounded-full bg-[var(--fg)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--bg)] disabled:opacity-40">
                    Burn from treasury
                  </button>
                  <span className="text-[11px] text-[var(--muted)]">The treasury burns them; only tokens no customer holds.</span>
                </div>
              )}
              {r.status === "approved" && isAdmin && r.kind === "mint" && (
                <div className="mt-2">
                  {cmd && sec?.token_address && data.contracts.treasury ? (
                    <>
                      <button
                        disabled={busy || !w.isIssuer}
                        title={!w.isIssuer ? "Connect the issuer wallet above" : undefined}
                        onClick={() => void sign(`Mint ${r.quantity} ${r.security}`, async () => {
                          const hash = await w.send({
                            address: sec.token_address as `0x${string}`, abi: tokenAbi as Abi, functionName: "mint",
                            args: [data.contracts.treasury as `0x${string}`, BigInt(baseUnits(r.quantity, sec.decimals))],
                          });
                          // Kept in the box, so if closing fails the hash is not lost
                          // and Confirm on-chain can be pressed again.
                          setHashes((h) => ({ ...h, [r.id]: hash }));
                          // Closed against the mined hash, which the server verifies again.
                          await onAct({ action: "complete-request", id: r.id, txHash: hash });
                        })}
                        className="rounded-full bg-[var(--fg)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--bg)] disabled:opacity-40"
                      >
                        Mint with issuer wallet
                      </button>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-[var(--muted)]">Or run it with cast and paste the hash</summary>
                        <Cmd text={cmd} />
                      </details>
                    </>
                  ) : (
                    <p className="text-[11px] text-[#b45309]">No token address or treasury configured, so there is nothing to mint into.</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      value={hashes[r.id] ?? ""} onChange={(e) => setHashes({ ...hashes, [r.id]: e.target.value.trim() })}
                      placeholder="0x… transaction hash"
                      className="tnum min-w-0 flex-1 rounded-xl border hairline bg-transparent px-3 py-2 text-[12px] outline-none focus:border-[var(--color-accent)]"
                    />
                    <button
                      onClick={() => void onAct({ action: "complete-request", id: r.id, txHash: hashes[r.id] })}
                      disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(hashes[r.id] ?? "")}
                      className="rounded-full bg-[var(--fg)] px-4 py-2 text-[12px] font-medium text-[var(--bg)] disabled:opacity-40"
                    >
                      Confirm on-chain
                    </button>
                  </div>
                </div>
              )}
              {r.status === "approved" && !isAdmin && (
                <p className="mt-1 text-[11px] text-[var(--muted)]">Approved. Waiting for CAPX to execute it with the issuer key.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * A logo, centre-cropped to a square and scaled to 256px.
 *
 * Done in the browser so a phone photo of a letterhead does not travel to the
 * server at twelve megapixels; what arrives is a few tens of kilobytes.
 */
async function squareLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return c.toDataURL("image/webp", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function RegisterSecurity({ onAct, busy, asBroker = false, preset = null, onDone }: {
  onAct: (b: Record<string, unknown>) => Promise<boolean | void>; busy: boolean;
  /** An existing security being edited: its fields and logo are loaded. */
  preset?: Security | null;
  onDone?: () => void;
  /** FIMCO's portal: registers drafts, cannot create tokens or go live. */
  asBroker?: boolean;
  w?: ReturnType<typeof useIssuer>; sign?: (label: string, fn: () => Promise<void>) => Promise<void>;
}) {
  // Fixed per mount, so the preview is fresh after a replacement but stable while editing.
  const [bust] = useState(() => Date.now() % 1e6);
  const [f, setF] = useState({
    symbol: preset?.symbol ?? "", name: preset?.name ?? "", tokenAddress: preset?.token_address ?? "",
    decimals: String(preset?.decimals ?? 8), status: preset?.status ?? (asBroker ? "draft" : "live"),
  });
  /*
   * Two kinds of listing.
   *
   * A DSE share CAPX tokenises itself needs an attestation, a token and a
   * mint. A token somebody else issued — a tokenised IPO — needs none of
   * that: CAPX buys it, holds it, and the balance is the backing. The form
   * asks which, because everything downstream differs.
   */
  const [ext, setExt] = useState({
    kind: (preset?.kind ?? "dse") as "dse" | "external",
    issuer: preset?.issuer ?? "", venue: preset?.venue ?? "", buyOnly: preset?.buyOnly ?? false,
  });
  const external = ext.kind === "external";
  const [logo, setLogo] = useState<string | null>(null);
  /** The logo already on file, shown until a new one is chosen. */
  const existingLogo = preset?.has_logo ? `/api/securities/logo?symbol=${encodeURIComponent(preset.symbol)}&v=${bust}` : null;
  const [logoErr, setLogoErr] = useState<string | null>(null);
  /*
   * A broker listing a new security says what it holds in the same form.
   *
   * Registering and attesting were two cards filled in one after the other,
   * and a registration without an attestation is a security nobody can do
   * anything with. Asking for both at once makes the draft CAPX reviews a
   * complete one.
   */
  const listing = asBroker && !preset;
  const [hold, setHold] = useState({ quantity: "", locked: "", docRef: "", expiresAt: "" });
  const [holdDoc, setHoldDoc] = useState<{ data: string; name: string } | null>(null);
  const hq = Number(hold.quantity) || 0;
  const hl = Number(hold.locked || hold.quantity) || 0;
  return (
    <div className="rounded-3xl border hairline p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">{preset ? `Edit ${preset.symbol}` : listing ? "List a new security" : "Register a security"}</div>
        {preset && onDone && (
          <button onClick={onDone} className="text-[11px] text-[var(--muted)] underline">Cancel</button>
        )}
      </div>
      {/*
        * The symbol is a key, not a label.
        *
        * It is what custody and the oracle are looked up by, so it has to match
        * the string those were written under — CRDB, the security, rather than
        * CRDBt, the token that represents it. Getting it wrong does not error:
        * the desk simply reports no attestation in force while one sits on the
        * registry, and issuance stays blocked with nothing to point at.
        */}
      {preset ? (
        <p className="mb-3 mt-2 text-[12px] text-[var(--muted)]">
          Symbol <span className="font-medium text-[var(--fg)]">{preset.symbol}</span> — the key everything else is stored under, so it cannot change.
        </p>
      ) : (
        <Field label="Symbol" v={f.symbol} on={(v) => setF({ ...f, symbol: v.toUpperCase() })} ph="CRDB"
          hint="The security's key in the custody registry and oracle: CRDB, not CRDBt." />
      )}
      <Field label="Name" v={f.name} on={(v) => setF({ ...f, name: v })} ph="CRDB Bank Plc" />
      {/*
        * The token address is filled in, not typed.
        *
        * A new security has no token until CAPX creates one, and Create token
        * below writes the address itself. FIMCO never sees the field; CAPX
        * only needs it for a token that was created outside the desk.
        */}
      {!asBroker && (
        <Field label={external ? "Token address" : "Token address · optional"} v={f.tokenAddress}
          on={(v) => setF({ ...f, tokenAddress: v })}
          ph={external ? "0x… the token CAPX will hold" : "Leave blank — Create token fills it in"}
          hint={external
            ? "The issuer's own token on Base. Checked against the chain, and its decimals read from it."
            : "Only for a token that already exists on Base. Checked against the chain before it is saved."} />
      )}
      {/*
        * Creating the token from here, signed by the issuer wallet.
        *
        * Two transactions: the factory creates it, then the issuer grants
        * itself the mint role, which a new B20 does not give its admin by
        * default — CRDBt's first mint failed on exactly that. The address is
        * derived from the symbol, so a token that already exists is found and
        * filled in rather than created twice.
        */}
      {asBroker && (
        <p className="mb-3 text-[11px] text-[var(--muted)]">
          No token is needed. CAPX reviews the listing, creates the token and tokenises the shares.
        </p>
      )}
      {!asBroker && !preset && (
        <p className="-mt-1 mb-3 text-[11px] text-[var(--muted)]">
          Save first. The security&rsquo;s card above then walks through creating its token, linking it and granting the mint role.
        </p>
      )}
      <label className="mb-3 block">
        <span className="eyebrow">Logo</span>
        <div className="mt-1.5 flex items-center gap-3">
          {logo || existingLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo ?? existingLogo ?? ""} alt="" className="h-12 w-12 rounded-full border hairline object-cover" />
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed hairline text-[10px] text-[var(--muted)]">none</span>
          )}
          <input
            type="file" accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setLogoErr(null);
              if (!file) return;
              try { setLogo(await squareLogo(file)); } catch { setLogoErr("That image could not be read."); }
            }}
            className="min-w-0 flex-1 text-[12px] file:mr-3 file:rounded-full file:border file:border-[var(--border)] file:bg-transparent file:px-3 file:py-1.5 file:text-[12px]"
          />
          {logo && <button onClick={() => setLogo(null)} className="text-[11px] text-[var(--muted)] underline">Remove</button>}
        </div>
        <span className="mt-1 block text-[11px] text-[var(--muted)]">
          {logoErr ?? (existingLogo && !logo
            ? "This is the logo on file. Choose a file to replace it."
            : "Square works best. Resized to 256px here before upload. Saving without one keeps the existing logo.")}
        </span>
      </label>
{!asBroker && (
        <label className="mb-3 block">
          <span className="eyebrow">Listing type</span>
          <div className="mt-1.5 flex gap-2">
            {([["dse", "CAPX tokenises it"], ["external", "Someone else's token"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setExt({ ...ext, kind: k })}
                className={`flex-1 rounded-xl border px-3 py-2 text-[12.5px] font-medium transition-colors ${
                  ext.kind === k ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"}`}>
                {l}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-[11px] text-[var(--muted)]">
            {external
              ? "CAPX buys this token and holds it; the treasury's balance is the backing. No attestation, no minting."
              : "FIMCO attests custody, CAPX creates the token and mints against it."}
          </span>
        </label>
      )}
      {external && !asBroker && (
        <>
          <Field label="Issued by" v={ext.issuer} on={(v) => setExt({ ...ext, issuer: v })} ph="GetEquity"
            hint="Named wherever this listing's backing is shown." />
          <Field label="Where CAPX buys it" v={ext.venue} on={(v) => setExt({ ...ext, venue: v })}
            ph="GetEquity Onchain pool · Base · pays in cNGN" hint="For the desk's own reference." />
          <label className="mb-3 flex items-start gap-2.5 rounded-xl surface p-3 text-[12px]">
            <input type="checkbox" checked={ext.buyOnly} onChange={(e) => setExt({ ...ext, buyOnly: e.target.checked })}
              className="mt-0.5 h-4 w-4" />
            <span>
              <span className="font-medium">Buying only for now</span>
              <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                For an open IPO the venue does not buy back yet. Customers see why, and a sell is refused
                rather than credited against something CAPX cannot sell.
              </span>
            </span>
          </label>
        </>
      )}
      {listing && (
        <div className="mb-3 rounded-2xl surface p-3.5">
          <div className="eyebrow">What FIMCO holds</div>
          <Field label="Shares held" v={hold.quantity} on={(v) => setHold({ ...hold, quantity: v.replace(/[^0-9.]/g, "") })} ph="1000" />
          <Field label="Of those, for tokenising" v={hold.locked} on={(v) => setHold({ ...hold, locked: v.replace(/[^0-9.]/g, "") })}
            ph={hold.quantity || "Same as held"} hint="Leave blank to tokenise all of them." />
          <Field label="FIMCO statement reference" v={hold.docRef} on={(v) => setHold({ ...hold, docRef: v })}
            ph="Holding statement or CDS reference" />
          <label className="block">
            <span className="eyebrow">Statement valid until</span>
            <input type="date" value={hold.expiresAt} onChange={(e) => setHold({ ...hold, expiresAt: e.target.value })}
              className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]" />
          </label>
          <div className="mt-3">
            <DocAttach doc={holdDoc?.data ?? null} name={holdDoc?.name ?? null}
              on={(d, n) => setHoldDoc(d && n ? { data: d, name: n } : null)} />
          </div>
          {hl > hq && hq > 0 && <p className="mt-2 text-[11px] text-[var(--color-down)]">Tokenised cannot exceed the shares held.</p>}
        </div>
      )}
      {external && f.tokenAddress && (
        <p className="-mt-1 mb-3 text-[11px] text-[var(--muted)]">
          Decimals are read from the token itself when this is saved, so they cannot be set wrong here.
        </p>
      )}
      {!asBroker && !external && (
              <Field label="Decimals" v={f.decimals} on={(v) => setF({ ...f, decimals: v })} ph="8"
        hint="Read from the token itself when an address is given." />
      )}
      {asBroker ? null : (
      <label className="mb-3 block">
        <span className="eyebrow">Status</span>
        <div className="mt-1.5 flex gap-2">
          {(["draft", "live"] as const).map((st) => (
            <button
              key={st}
              onClick={() => setF({ ...f, status: st })}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-[13px] font-medium capitalize transition-colors ${
                f.status === st ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
        <span className="mt-1 block text-[11px] text-[var(--muted)]">
          Draft keeps it off the public proof page. A security customers can buy should be live.
        </span>
      </label>
      )}
      <button
        onClick={() => void (async () => {
          const ok = await onAct({ action: "register-security", ...f, ...ext, decimals: Number(f.decimals), ...(logo ? { logo } : {}) });
          if (ok === false) return;
          if (listing) {
            const filed = await onAct({
              action: "attest", security: f.symbol, custodian: PRIMARY_BROKER, quantity: hq, locked: hl, docRef: hold.docRef,
              expiresAt: new Date(`${hold.expiresAt}T23:59:59Z`).toISOString(), listing: true,
              document: holdDoc?.data ?? null, documentName: holdDoc?.name ?? null,
            });
            if (filed === false) return;
            setF({ symbol: "", name: "", tokenAddress: "", decimals: "8", status: "draft" });
            setHold({ quantity: "", locked: "", docRef: "", expiresAt: "" });
            setHoldDoc(null);
            setLogo(null);
          }
          onDone?.();
        })()}
        disabled={busy || !f.symbol || !f.name
          || (external && !/^0x[0-9a-fA-F]{40}$/.test(f.tokenAddress.trim()))
          || (listing && (!(hq > 0) || hl > hq || !hold.docRef.trim() || !hold.expiresAt))}
        className="mt-2 w-full rounded-full bg-[var(--fg)] py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
      >
        {preset ? "Save changes" : listing ? `List ${f.symbol || "security"} for CAPX review` : "Save"}
      </button>
    </div>
  );
}

/**
 * The broker that confirms custody holdings.
 *
 * FIMCO is CAPX's main broker for attestations, so it is the default party on
 * a filing. It is a default and not a stamp: the filing still cannot go in
 * without FIMCO's own statement reference, so naming them always points at a
 * document they issued rather than at a holding nobody asked them about.
 */
export const PRIMARY_BROKER = "FIMCO";

/**
 * Downloads the document filed with an attestation.
 *
 * Fetched rather than linked because the route is behind the desk's token,
 * and a token cannot ride on an anchor.
 */
async function openAttestationDoc(token: string, a: Attestation) {
  const res = await fetch(`/api/admin/custody/document?id=${a.id}`, {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  const el = document.createElement("a");
  el.href = url; el.download = a.documentName || `${a.security}-attestation`;
  document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** About 4 MB of file once base64 has added its third. */
const MAX_DOC = 5_600_000;

/**
 * The document behind the attestation: a pledge of shares, or the holding
 * statement the reference points at.
 *
 * A reference number says a document exists somewhere. This is the document,
 * so the person approving can read the thing they are approving rather than
 * taking the number on trust.
 */
function DocAttach({ doc, name, on }: {
  doc: string | null; name: string | null;
  on: (doc: string | null, name: string | null) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <label className="mb-3 block">
      <span className="eyebrow">Attach the statement</span>
      {doc ? (
        <span className="mt-1.5 flex items-center gap-2 rounded-xl border hairline px-3.5 py-2.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <button onClick={() => { on(null, null); setErr(null); }} className="text-[11px] text-[var(--muted)] underline">
            Remove
          </button>
        </span>
      ) : (
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const url = String(reader.result ?? "");
              if (url.length > MAX_DOC) { setErr("That file is too large. Keep it under 4 MB."); return; }
              setErr(null); on(url, file.name);
            };
            reader.readAsDataURL(file);
          }}
          className="mt-1.5 w-full text-[12px] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--fg)] file:px-3 file:py-1.5 file:text-[12px] file:text-[var(--bg)]"
        />
      )}
      <span className="mt-1 block text-[11px] text-[var(--muted)]">
        {err ?? "PDF or photo, up to 4 MB. The pledge of shares or the holding statement itself."}
      </span>
    </label>
  );
}

function FileAttestation({ onAct, busy, lockToBroker = false, securities = [] }: {
  onAct: (b: Record<string, unknown>) => Promise<boolean | void>; busy: boolean;
  /** FIMCO's own portal files as FIMCO; there is no party to choose. */
  lockToBroker?: boolean; securities?: string[];
}) {
  const [f, setF] = useState({ security: "CRDB", custodian: PRIMARY_BROKER, quantity: "", locked: "", docRef: "", expiresAt: "" });
  const [doc, setDoc] = useState<{ data: string; name: string } | null>(null);
  const [other, setOther] = useState(false);
  const q = Number(f.quantity) || 0;
  const l = Number(f.locked || f.quantity) || 0;
  const isBroker = lockToBroker || (!other && f.custodian === PRIMARY_BROKER);
  return (
    <div className="rounded-3xl border hairline p-5">
      <div className="eyebrow">{lockToBroker ? "Update a holding" : "File a custody attestation"}</div>
      {lockToBroker && (
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          For a company already listed. Enter the new total FIMCO holds, not the increase — CAPX mints the difference.
        </p>
      )}
      <Field label="Security" v={f.security} on={(v) => setF({ ...f, security: v.toUpperCase() })} ph="CRDB"
        hint={securities.length ? `Registered: ${securities.join(", ")}. The security, not the token: CRDB, not CRDBt.` : "The registered security's symbol: CRDB, not CRDBt."} />
      {lockToBroker ? (
        <p className="mb-3 text-[12px] text-[var(--muted)]">Filed as <span className="font-medium text-[var(--fg)]">{PRIMARY_BROKER}</span>. CAPX reviews it before it is published.</p>
      ) : (
      <label className="mb-3 block">
        <span className="eyebrow">Attested by</span>
        <div className="mt-1.5 flex gap-2">
          <button
            onClick={() => { setOther(false); setF({ ...f, custodian: PRIMARY_BROKER }); }}
            className={`flex-1 rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
              isBroker ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
            }`}
          >
            {PRIMARY_BROKER}
            <span className={`ml-1.5 text-[11px] font-normal ${isBroker ? "opacity-70" : "text-[var(--muted)]"}`}>main broker</span>
          </button>
          <button
            onClick={() => { setOther(true); setF({ ...f, custodian: "" }); }}
            className={`rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors ${
              other ? "border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]" : "hairline hover:surface"
            }`}
          >
            Other
          </button>
        </div>
        {other && (
          <input
            value={f.custodian} onChange={(e) => setF({ ...f, custodian: e.target.value })}
            placeholder="Who is confirming the holding"
            className="mt-2 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        )}
      </label>
      )}
      <Field label={lockToBroker ? "Total shares now held" : "Shares held"} v={f.quantity} on={(v) => setF({ ...f, quantity: v.replace(/[^0-9.]/g, "") })} ph="100" />
      <Field label="Of those, locked" v={f.locked} on={(v) => setF({ ...f, locked: v.replace(/[^0-9.]/g, "") })} ph="100" />
      <Field label={isBroker ? `${PRIMARY_BROKER} statement reference` : "Custodian reference"} v={f.docRef}
        on={(v) => setF({ ...f, docRef: v })}
        ph={isBroker ? "Holding statement or CDS reference from FIMCO" : "Statement or reference number"}
        hint="Required. The attestation is only as good as the document it points to." />
      <label className="mb-3 block">
        <span className="eyebrow">Expires</span>
        <input
          type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })}
          className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </label>
      <DocAttach doc={doc?.data ?? null} name={doc?.name ?? null}
        on={(d, n) => setDoc(d && n ? { data: d, name: n } : null)} />
      {l > q && q > 0 && (
        <p className="mb-2 text-[11px] text-[var(--color-down)]">Locked cannot exceed the shares held.</p>
      )}
      <button
        onClick={() => void onAct({
          action: "attest", ...f, quantity: q, locked: l,
          expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T23:59:59Z`).toISOString() : "",
          document: doc?.data ?? null, documentName: doc?.name ?? null,
        }).then((okay) => { if (okay !== false) setDoc(null); })}
        disabled={busy || !f.security || !f.custodian.trim() || !f.docRef.trim() || !(q > 0) || l > q || !f.expiresAt}
        className="mt-1 w-full rounded-full bg-[var(--fg)] py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40"
      >
        File for approval
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
        Filing does not issue anything. It has to be approved first, and approval is
        the moment CAPX asserts these shares are really in the vault.
      </p>
    </div>
  );
}

/**
 * The reference price, with its source on the record.
 *
 * Prices are entered in whole shillings and converted to nTZS's eighteen
 * decimals on the way out, because that is the unit settlement works in and
 * expecting an operator to type 2500000000000000000000 invites the kind of
 * mistake that prices a trade a thousand times wrong.
 */
function OracleAdmin({ token, busy, setBusy, setErr, setNote }: {
  token: string; busy: boolean;
  setBusy: (b: boolean) => void;
  setErr: (s: string | null) => void;
  setNote: (s: string | null) => void;
}) {
  const [f, setF] = useState({ symbol: "CRDB", price: "", source: "DSE reference (manual)" });
  const [quotes, setQuotes] = useState<{ symbol: string; price: number; source: string; updatedAt: string; fresh: boolean }[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/oracle", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setQuotes(j.quotes ?? []);
    } catch { /* the desk still works without the list */ }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void load(); };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearTimeout(first); clearInterval(id); };
  }, [load]);

  const save = async () => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/oracle", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol: f.symbol, priceTzs: Number(f.price), source: f.source }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Could not set the price");
      setNote(`${f.symbol} marked at ${Number(f.price).toLocaleString()} TZS.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not set the price");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 rounded-3xl border hairline p-5">
      <div className="eyebrow">Price feed</div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-[7rem] flex-1">
          <span className="eyebrow">Symbol</span>
          <input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })}
            className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]" />
        </label>
        <label className="min-w-[9rem] flex-1">
          <span className="eyebrow">Price (whole TZS)</span>
          <input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, "") })}
            inputMode="decimal" placeholder="2500"
            className="tnum mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]" />
        </label>
        <label className="min-w-[12rem] flex-[2]">
          <span className="eyebrow">Source</span>
          <input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}
            className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]" />
        </label>
        <button onClick={() => void save()} disabled={busy || !f.symbol || !(Number(f.price) > 0)}
          className="rounded-full bg-[var(--fg)] px-5 py-2.5 text-[13px] font-medium text-[var(--bg)] disabled:opacity-40">
          Set price
        </button>
      </div>

      {quotes.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border hairline">
          {/*
            * A row is the way to change that mark.
            *
            * The form opens on CRDB, so re-pricing anything else meant typing
            * its symbol by hand with nothing to check it against — one typo
            * away from marking the wrong security. Pressing a row loads it.
            */}
          {quotes.map((q) => (
            <button
              key={q.symbol}
              onClick={() => setF({ symbol: q.symbol, price: String(q.price), source: q.source })}
              title={`Edit ${q.symbol}'s price`}
              className={`flex w-full flex-wrap items-center gap-3 border-b hairline px-4 py-2.5 text-left transition-colors last:border-0 hover:surface ${
                f.symbol === q.symbol ? "surface" : ""}`}
            >
              <span className="w-16 text-sm font-medium">{q.symbol}</span>
              <span className="tnum flex-1 text-sm">{q.price.toLocaleString()} TZS</span>
              <span className="text-[11px] text-[var(--muted)]">{q.source}</span>
              <span className="text-[11px] text-[var(--muted)]">{dt(q.updatedAt)}</span>
              {/* A stale mark must be visible: settlement refuses to price
                  against it, and the desk should say so before someone tries. */}
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                q.fresh ? "bg-[var(--color-up)]/10 text-[var(--color-up)]" : "bg-[var(--color-down)]/10 text-[var(--color-down)]"}`}>
                {q.fresh ? "live" : "stale"}
              </span>
              <span className="text-[11px] text-[var(--muted)]">edit</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        Entered in whole shillings and stored with its source and timestamp. Press a row to
        change that security&rsquo;s price. Settlement refuses to price a trade against a mark that
        has gone stale, and a mark goes stale four days after it is set — a DSE listing is
        re-marked automatically from the exchange, but a manually priced one has to be set
        again before then or it stops trading.
      </p>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg)] px-3 py-2.5">
      <div className="eyebrow leading-tight">{label}</div>
      <div className="tnum mt-1 truncate text-[15px] font-medium">{value}</div>
    </div>
  );
}

function Field({ label, v, on, ph, hint }: {
  label: string; v: string; on: (v: string) => void; ph?: string; hint?: string;
}) {
  return (
    <label className="mb-3 block">
      <span className="eyebrow">{label}</span>
      <input value={v} onChange={(e) => on(e.target.value)} placeholder={ph}
        className="mt-1.5 w-full rounded-xl border hairline bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]" />
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}
