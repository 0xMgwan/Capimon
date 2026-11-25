"use client";

import { useMemo, useState } from "react";
import { txUrl, addressUrl, tokenUrl, shortHash } from "@/lib/explorer";

/**
 * The furniture the oversight portal is built from.
 *
 * Split out of the portal itself because the page is five tables wearing
 * different column headings, and the parts they share — sorting, searching,
 * the chain links, the CSV — were going to be written five times otherwise.
 */

export const tzs = (n: number) => Math.round(n).toLocaleString();
export const qty = (n: number) => (Math.abs(n) >= 1 ? n.toFixed(2) : n.toFixed(4));
export const when = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
export const day = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "—";

export type Tone = "ok" | "warn" | "bad" | "flat";

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const c = tone === "ok" ? "var(--color-up)" : tone === "bad" ? "var(--color-down)"
    : tone === "warn" ? "var(--color-accent)" : "var(--muted)";
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color: c, borderColor: c }}>{children}</span>
  );
}

export const kycTone = (s: string): Tone =>
  s === "approved" ? "ok" : s === "pending" ? "warn" : "bad";
export const statusTone = (s: string): Tone =>
  ["settled", "sent", "approved", "credited"].includes(s) ? "ok"
    : ["failed", "cancelled", "rejected", "revoked"].includes(s) ? "bad" : "warn";

function Out() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" aria-hidden className="shrink-0 opacity-70">
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

/**
 * A transaction, linked.
 *
 * The portal previously printed bare hashes. On a page whose purpose is to
 * let somebody check CAPX's claims against the chain, an unclickable hash
 * asks the reader to select sixty-six characters without missing one, and
 * most readers simply will not — so the claim goes unchecked and the hash
 * was decoration.
 */
export function Tx({ hash, chainId, label }: {
  hash: string | null | undefined; chainId?: number; label?: string;
}) {
  if (!hash) return <span className="text-[var(--muted)]">—</span>;
  return (
    <a href={txUrl(hash, chainId)} target="_blank" rel="noreferrer noopener" title={hash}
      className="tnum inline-flex items-center gap-1 text-[11px] text-[var(--color-accent)] underline decoration-dotted underline-offset-2 hover:decoration-solid">
      {label ?? shortHash(hash)}
      <Out />
    </a>
  );
}

export function Addr({ address, chainId, kind = "address", label }: {
  address: string | null | undefined; chainId?: number;
  kind?: "address" | "token"; label?: string;
}) {
  if (!address) return <span className="text-[var(--muted)]">—</span>;
  const href = kind === "token" ? tokenUrl(address, chainId) : addressUrl(address, chainId);
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" title={address}
      className="tnum inline-flex items-center gap-1 text-[11px] text-[var(--color-accent)] underline decoration-dotted underline-offset-2 hover:decoration-solid">
      {label ?? shortHash(address, 8, 6)}
      <Out />
    </a>
  );
}

/**
 * A trade's contract-note reference.
 *
 * Styled like a hash because it sits where a hash would, and deliberately
 * not shaped like one: `CRDB-261124-7F3A9C2E` could not be pasted into a
 * block explorer by mistake, which a sixty-six character hex string that
 * leads nowhere invites. Click copies it, because the whole use of a
 * reference is being quoted somewhere else.
 */
export function Ref({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-[var(--muted)]">—</span>;
  return (
    <button type="button" title="Copy this reference"
      onClick={() => {
        navigator.clipboard?.writeText(value)
          .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })
          .catch(() => {});
      }}
      className="tnum whitespace-nowrap text-left text-[11px] underline decoration-dotted underline-offset-2 hover:decoration-solid">
      {value}
      {copied && <span className="ml-1 text-[var(--color-up)]">copied</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */

export type SortDir = "asc" | "desc";
export type Sort = { key: string; dir: SortDir } | null;

/**
 * Sorting that knows nothing about the rows.
 *
 * Columns declare how to read their own value; everything else — the toggle,
 * the arrow, nulls last, numbers before strings — is handled once. Nulls sort
 * last in both directions on purpose: a missing settlement date is not
 * "earliest", and a table that claims it is sends somebody looking into the
 * wrong rows first.
 */
export function useSort(initial: Sort = null) {
  const [sort, setSort] = useState<Sort>(initial);
  const toggle = (key: string) =>
    setSort((s) => (s?.key === key
      ? (s.dir === "desc" ? { key, dir: "asc" } : null)
      : { key, dir: "desc" }));
  return { sort, toggle };
}

export function sorted<T>(rows: T[], sort: Sort, read: (row: T, key: string) => unknown): T[] {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = read(a, sort.key);
    const y = read(b, sort.key);
    const xn = x === null || x === undefined || x === "";
    const yn = y === null || y === undefined || y === "";
    if (xn && yn) return 0;
    if (xn) return 1;
    if (yn) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
  });
}

export type Col = { key?: string; label: string; align?: "right"; width?: string };

export function Table({ cols, sort, onSort, children, empty }: {
  cols: Col[]; sort?: Sort; onSort?: (key: string) => void;
  children: React.ReactNode; empty?: string;
}) {
  const kids = Array.isArray(children) ? (children as React.ReactNode[]).flat() : children;
  const isEmpty = Array.isArray(kids) ? kids.length === 0 : !kids;
  return (
    <div className="mt-3 max-h-[70vh] overflow-auto rounded-2xl border hairline">
      <table className="w-full min-w-[720px] text-left text-[12.5px]">
        <thead className="sticky top-0 z-10">
          <tr className="surface">
            {cols.map((c) => {
              const active = !!sort?.key && c.key === sort.key;
              return (
                <th key={c.label} style={c.width ? { width: c.width } : undefined}
                  className={`whitespace-nowrap border-b hairline bg-[var(--surface)] px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--muted)] ${
                    c.align === "right" ? "text-right" : ""
                  } ${c.key && onSort ? "cursor-pointer select-none hover:text-[var(--fg)]" : ""}`}
                  onClick={() => c.key && onSort?.(c.key)}>
                  {c.label}
                  {c.key && onSort && (
                    <span className={`ml-1 inline-block ${active ? "" : "opacity-25"}`}>
                      {active && sort && sort.dir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {isEmpty
            ? <tr><td colSpan={cols.length}
                className="px-3 py-8 text-center text-[var(--muted)]">
                {empty ?? "Nothing here yet."}
              </td></tr>
            : kids}
        </tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className = "", align }: {
  children: React.ReactNode; className?: string; align?: "right";
}) => (
  <td className={`border-t hairline px-3 py-2.5 align-top ${align === "right" ? "text-right" : ""} ${className}`}>
    {children}
  </td>
);

export const Row = ({ children }: { children: React.ReactNode }) => (
  <tr className="transition-colors hover:bg-[var(--surface)]">{children}</tr>
);

/* ------------------------------------------------------------------ */

export type Choice = { label: string; value: string };

/**
 * Search, filters, the count, and the download.
 *
 * The count is not decoration. On a filtered table "14 of 212" is the only
 * thing that distinguishes a search that found little from a search that
 * matched nothing and is quietly showing you everything.
 */
export function Toolbar({ q, onQ, placeholder, filters, shown, total, onCsv }: {
  q: string; onQ: (v: string) => void; placeholder: string;
  filters?: { label: string; value: string; onChange: (v: string) => void; options: Choice[] }[];
  shown: number; total: number; onCsv?: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder}
        className="min-w-[220px] flex-1 rounded-xl border hairline bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]"
      />
      {filters?.map((f) => (
        <select key={f.label} value={f.value} onChange={(e) => f.onChange(e.target.value)}
          aria-label={f.label}
          className="rounded-xl border hairline bg-transparent px-2.5 py-2 text-[12.5px] outline-none focus:border-[var(--color-accent)]">
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
      <span className="tnum whitespace-nowrap text-[11.5px] text-[var(--muted)]">
        {shown === total ? `${total}` : `${shown} of ${total}`}
      </span>
      {onCsv && (
        <button onClick={onCsv}
          className="whitespace-nowrap rounded-xl border hairline px-3 py-2 text-[12px] font-medium hover:surface">
          Download CSV
        </button>
      )}
    </div>
  );
}

/** Builds a CSV from whatever is on screen, filters and all. */
export function downloadCsv(name: string, head: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [head.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Case-insensitive match across the fields a row chooses to expose. */
export function useSearch<T>(rows: T[], q: string, fields: (row: T) => (string | null | undefined)[]) {
  return useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => fields(r).some((f) => (f ?? "").toLowerCase().includes(needle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q]);
}

export function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: Tone;
}) {
  const c = tone === "bad" ? "var(--color-down)" : tone === "ok" ? "var(--color-up)" : undefined;
  return (
    <div className="rounded-2xl border hairline p-4">
      <div className="eyebrow leading-tight">{label}</div>
      <div className="tnum mt-1.5 text-xl font-medium" style={c ? { color: c } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">{sub}</div>}
    </div>
  );
}
