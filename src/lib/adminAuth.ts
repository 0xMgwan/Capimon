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

/**
 * A desk token is presented in one place: an Authorization header.
 *
 * It used to be readable from the query string as well, because an `<img
 * src>` carries no headers and the KYC and custody document routes are
 * loaded by one. That put a credential opening the whole estate into browser
 * history, referrers and every access log in between, in a URL that also
 * named somebody's identity document.
 *
 * Those routes now take a short-lived grant instead — see imageGrant.ts —
 * which names one document, lapses in ten minutes and is signed under a key
 * derived from the minting role's own token. So nothing needs the query
 * string any more, and the exception that existed for them is gone rather
 * than narrowed: a route added later cannot opt back in by accident, because
 * there is no longer anything to opt into.
 */
function presented(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
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

/**
 * The signing material behind an image grant, for that module alone.
 *
 * Not the token itself as a convenience getter — it is the token, and a
 * function that hands it out invites a second caller who only wanted to
 * compare it. imageGrant.ts derives a key from this and never stores or
 * transmits it; see the reasoning there for why a role's own token is the
 * right key.
 */
export function grantKeyFor(role: ViewerRole): string {
  if (role === "dse") return DSE_TOKEN;
  return OPS_TOKENS.find(([r]) => r === role)?.[1] ?? "";
}

/**
 * Mints a grant for the caller, when they are entitled to the document.
 *
 * Minting is deliberately only possible from an already-authenticated
 * request: the grant is a narrowing of what the caller can already do, never
 * a way to obtain access. A viewer with no role gets null and the listing
 * that asked simply carries no link.
 */
export async function grantFor(
  req: Request, id: string, which: "doc" | "selfie",
): Promise<string | null> {
  const role = viewerOf(req);
  if (!role) return null;
  const { signGrant } = await import("./imageGrant");
  return signGrant({ role, id, which }, grantKeyFor(role));
}
