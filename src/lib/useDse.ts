"use client";

import { useEffect, useState } from "react";

/**
 * Every tokenised DSE share a customer can see, for pickers, lists and logos.
 *
 * One request per page load, shared by every component that mounts: the
 * picker, the markets list and the activity rows all ask for the same list.
 */
export type DseListing = {
  symbol: string; name: string; logo: string | null; status: string;
  /** The share token's address on Base, for anyone who wants to check it. */
  token?: string | null;
  price: number; changePct: number; tradeDate: string | null; feeBps: number;
  /**
   * Where the shown price came from: "dse" live from the exchange, "oracle"
   * the last published mark while the exchange is down, "capx" a price CAPX
   * set by hand for a listing the exchange does not quote.
   */
  source?: "dse" | "oracle" | "capx" | "none";
  /** "external": a token another issuer made, which CAPX buys and holds. */
  kind?: "dse" | "external";
  issuer?: string | null;
  /** True while the venue does not buy back — an open IPO. */
  buyOnly?: boolean;
  /** When the fallback price was published. */
  asOf?: string | null;
};

let cache: DseListing[] | null = null;
let inflight: Promise<DseListing[]> | null = null;

function fetchList(): Promise<DseListing[]> {
  inflight ??= fetch("/api/securities/dse", { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => (cache = j?.ok ? (j.securities as DseListing[]) : cache ?? []))
    .catch(() => cache ?? [])
    .finally(() => { inflight = null; });
  return inflight;
}

export function useDse(): DseListing[] {
  const [list, setList] = useState<DseListing[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    fetchList().then((l) => { if (alive) setList(l); });
    return () => { alive = false; };
  }, []);
  return list;
}

/** A DSE asset's logo, or undefined when the asset is not a DSE listing. */
export function dseLogoOf(list: DseListing[], asset: string): string | null | undefined {
  const d = list.find((x) => x.symbol === asset);
  if (!d) return asset === "CRDB" ? "/crdb.jpg" : undefined;
  return d.logo;
}

/** Does a search string match this listing? */
export function matchesDse(d: DseListing, query: string) {
  const s = query.trim().toLowerCase();
  if (!s) return true;
  return [d.symbol, d.name, "dse", "dar es salaam", "tanzania", `${d.symbol}t`]
    .some((t) => t.toLowerCase().includes(s) || (s.length > 2 && s.includes(t.toLowerCase())));
}
