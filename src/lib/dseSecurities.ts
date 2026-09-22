import "server-only";
import { db, dbConfigured, migrate } from "./db";
import { CRDBT, CRDBT_DECIMALS, CRDBT_SECURITY } from "./assets";

/**
 * The securities CAPX lists, read from the registry table.
 *
 * Everything that used to name CRDB directly — trading, prices, the treasury's
 * holdings, the portfolio — reads this list instead, so registering NMB on the
 * desk and creating its token is all it takes for it to appear everywhere CRDB
 * does. Nothing here is NMB-specific; the next listing needs no code.
 *
 * A security is only on the list once it has a token, because until then there
 * is nothing to hold, price against custody, or sell.
 *
 * Two kinds sit here. "dse" is a share CAPX tokenised itself: FIMCO attests
 * custody, the issuer key mints, and backing is the attestation. "external" is
 * a token somebody else issued — a tokenised IPO, another issuer's equity —
 * that CAPX buys and holds; there is nothing to mint or attest, and the
 * backing is simply the balance the treasury holds, which anyone can read.
 * Both trade the same way: a shilling ledger against an oracle price.
 */
export type DseSecurity = {
  /** The DSE code, and the key for custody, the oracle and the ledger: NMB, not NMBt. */
  symbol: string;
  name: string;
  token: `0x${string}`;
  decimals: number;
  /** draft | live | suspended. Customers can only buy a live one. */
  status: string;
  /** A URL for the company's mark, or null to fall back to initials. */
  logo: string | null;
  /** "dse" — tokenised by CAPX; "external" — someone else's token, bought and held. */
  kind: "dse" | "external";
  /** Who issued an external token, shown wherever its backing is. */
  issuer: string | null;
  /** Where CAPX buys it, for the desk's own reference. */
  venue: string | null;
  /**
   * Selling is closed.
   *
   * A tokenised IPO cannot be sold until its allocation completes and it
   * lists, so the listing says so rather than offering a sell that would
   * fail at the venue.
   */
  buyOnly: boolean;
};

/** CRDB as it was hardwired, so a database outage cannot hide the live security. */
const CRDB_FALLBACK: DseSecurity = {
  symbol: CRDBT_SECURITY, name: "CRDB Bank Plc", token: CRDBT,
  decimals: CRDBT_DECIMALS, status: "live", logo: "/crdb.jpg",
  kind: "dse", issuer: null, venue: null, buyOnly: false,
};

/** Where a security's logo is served from. CRDB keeps its bundled image. */
export function logoUrl(symbol: string, hasLogo: boolean): string | null {
  if (symbol === CRDBT_SECURITY) return "/crdb.jpg";
  return hasLogo ? `/api/securities/logo?symbol=${encodeURIComponent(symbol)}` : null;
}

let cache: { at: number; list: DseSecurity[] } | null = null;
const TTL_MS = 30_000;

export async function dseSecurities(): Promise<DseSecurity[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
  if (!dbConfigured) return [CRDB_FALLBACK];
  try {
    await migrate();
    const rows = await db()<{ symbol: string; name: string; token_address: string; decimals: number;
                              status: string; has_logo: boolean; kind: string | null;
                              issuer: string | null; venue: string | null; buy_only: boolean | null }[]>`
      select symbol, name, token_address, decimals, status, (metadata ? 'logo') as has_logo,
             metadata->>'kind' as kind, metadata->>'issuer' as issuer, metadata->>'venue' as venue,
             (metadata->>'buyOnly')::boolean as buy_only
        from capx.securities
       where token_address is not null
       order by (symbol = ${CRDBT_SECURITY}) desc, symbol`;
    const list: DseSecurity[] = rows.map((r) => ({
      symbol: r.symbol.toUpperCase(), name: r.name,
      token: r.token_address.toLowerCase() as `0x${string}`, decimals: Number(r.decimals),
      status: r.status, logo: logoUrl(r.symbol.toUpperCase(), r.has_logo),
      kind: r.kind === "external" ? "external" : "dse",
      issuer: r.issuer, venue: r.venue, buyOnly: r.buy_only === true,
    }));
    if (!list.some((s) => s.symbol === CRDBT_SECURITY)) list.unshift(CRDB_FALLBACK);
    cache = { at: Date.now(), list };
    return list;
  } catch {
    return cache?.list ?? [CRDB_FALLBACK];
  }
}

export async function dseSecurity(symbol: string): Promise<DseSecurity | null> {
  const s = symbol.trim().toUpperCase();
  return (await dseSecurities()).find((x) => x.symbol === s) ?? null;
}

/** Is this ledger asset a DSE security (priced in shillings by our oracle)? */
export async function isDseAsset(asset: string): Promise<boolean> {
  return (await dseSecurities()).some((x) => x.symbol === asset.toUpperCase());
}
