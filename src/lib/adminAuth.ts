import { timingSafeEqual } from "crypto";

/**
 * Who is calling an operations route.
 *
 * Two tokens, two roles. The admin token opens everything — KYC documents,
 * withdrawals, customer records — so it stays CAPX's alone. FIMCO gets its own
 * token scoped to the custody desk: it can see every security, attestation,
 * issuance and holding, file attestations and ask for tokens to be minted, but
 * it cannot approve its own filings or reach anything outside the desk.
 *
 * Keeping them separate also means either can be rotated without locking the
 * other out, and every action records which of the two took it.
 */
export type OpsRole = "admin" | "fimco";

const TOKENS: [OpsRole, string][] = [
  ["admin", process.env.ADMIN_TOKEN ?? ""],
  ["fimco", process.env.FIMCO_TOKEN ?? ""],
];

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function roleOf(req: Request): OpsRole | null {
  const url = new URL(req.url);
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
    || url.searchParams.get("token") || "";
  if (!given) return null;
  for (const [role, token] of TOKENS) {
    if (token && same(given, token)) return role;
  }
  return null;
}

/** How each role is written into the audit columns. */
export const ACTOR: Record<OpsRole, string> = { admin: "CAPX", fimco: "FIMCO" };
