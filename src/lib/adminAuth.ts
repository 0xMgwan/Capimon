import { timingSafeEqual } from "crypto";

/**
 * Who is calling an operations route.
 *
 * Two tokens operate CAPX. The admin token opens everything — KYC documents,
 * withdrawals, customer records — so it stays CAPX's alone. FIMCO gets its own
 * token scoped to the custody desk: it can see every security, attestation,
 * issuance and holding, file attestations and ask for tokens to be minted, but
 * it cannot approve its own filings or reach anything outside the desk.
 *
 * Keeping them separate also means either can be rotated without locking the
 * other out, and every action records which of the two took it.
 *
 * A third token exists and is deliberately *not* one of these. See `viewerOf`.
 */
export type OpsRole = "admin" | "fimco";

/**
 * Roles that may look without operating.
 *
 * DSE supervises the market CAPX lists into; it does not run CAPX. Its token
 * reads the Dar es Salaam book in full — customers, identity documents,
 * holdings, orders, money in and out — and writes nothing.
 *
 * The reason it is a separate type, rather than a third `OpsRole`, is the
 * shape of the routes that already exist. Most of them ask only whether there
 * is a role at all and then serve the whole estate: the entire holder
 * register, the custody desk's write actions, the data export. Adding a third
 * member to `OpsRole` would have widened every one of them at once, silently,
 * and the next route written the same way would widen it again. So `roleOf`
 * still answers the question it always answered and cannot return "dse",
 * and the oversight routes ask `viewerOf` instead. A read DSE is allowed to
 * make is one somebody wrote for it on purpose.
 */
export type ViewerRole = OpsRole | "dse";

const OPS_TOKENS: [OpsRole, string][] = [
  ["admin", process.env.ADMIN_TOKEN ?? ""],
  ["fimco", process.env.FIMCO_TOKEN ?? ""],
];

const DSE_TOKEN = process.env.DSE_TOKEN ?? "";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function presented(req: Request): string {
  const url = new URL(req.url);
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
    || url.searchParams.get("token") || "";
}

export function roleOf(req: Request): OpsRole | null {
  const given = presented(req);
  if (!given) return null;
  for (const [role, token] of OPS_TOKENS) {
    if (token && same(given, token)) return role;
  }
  return null;
}

/**
 * The same question, asked where oversight is allowed.
 *
 * Returns "dse" for the exchange's token, and still returns "admin" or
 * "fimco" for the operating tokens — CAPX opening the oversight portal should
 * see exactly what DSE sees, because a supervisor's view nobody internally
 * ever looks at is a view nobody notices has broken.
 */
export function viewerOf(req: Request): ViewerRole | null {
  const given = presented(req);
  if (!given) return null;
  if (DSE_TOKEN && same(given, DSE_TOKEN)) return "dse";
  return roleOf(req);
}

/** How each role is written into the audit columns. */
export const ACTOR: Record<ViewerRole, string> = {
  admin: "CAPX", fimco: "FIMCO", dse: "DSE",
};

/**
 * Whether a role may change anything.
 *
 * Asked at the top of every oversight route that could write, so a write path
 * added later refuses an observer by default rather than by being remembered.
 */
export const canWrite = (role: ViewerRole): boolean => role !== "dse";
