/**
 * The username rule, in one place — and it is deliberately forgiving.
 *
 * A handle is a convenience: it is how someone logs in without typing an
 * email, and nothing else hangs off it. So the old rule, which refused
 * anything carrying a dot, a hyphen, a space or a capital, was rejecting
 * people over a nicety. Most of what it turned away was a perfectly good
 * name written the way a person writes their name.
 *
 * What happens instead is that the input is cleaned rather than refused:
 * "@David Machuche" becomes "david_machuche" and is accepted. Only two
 * things are actually still errors — too short to be a handle at all, and
 * already belonging to somebody else — and both are things the customer can
 * see and fix. It also stays optional: an account needs an email, not a
 * handle.
 *
 * Free of server-only imports on purpose, so the form states the same rule
 * the API enforces.
 */
export const USERNAME_HINT = "At least 3 characters — letters, numbers, . _ or -";

/** How long a handle may be. Anything past this is trimmed, not refused. */
const MAX = 20;
const MIN = 3;

/**
 * Turns whatever was typed into a usable handle.
 *
 * Lowercased, because a handle that differs from another only by case is a
 * handle two people will confuse; spaces and anything else unusable become
 * underscores rather than an error; leading "@" goes, since that is how
 * handles are written everywhere else.
 */
export function cleanUsername(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^@+/, "")
    // An accent becomes its plain letter rather than being thrown away:
    // "José" is jose, not jos_.
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Anything that is not a letter, a digit or a separator becomes one.
    .replace(/[^a-z0-9._-]+/g, "_")
    // A run of separators reads as a slip, so it collapses to one.
    .replace(/[._-]{2,}/g, "_")
    .slice(0, MAX)
    // Neither end should be a separator — after the trim, so a cut that lands
    // on one does not leave it dangling.
    .replace(/^[._-]+|[._-]+$/g, "");
}

/**
 * Handles nobody may take, because taking one would let a customer pass for
 * CAPX or for someone they would then be trusted as.
 *
 * Not a naming policy — an impersonation control. Somebody messaging another
 * customer as @support, or appearing in a list as @capx, is the beginning of
 * a story that ends with a transfer nobody authorised. The separators are
 * collapsed out before this is checked, so @c_a_p_x does not walk past it.
 */
const RESERVED = new Set([
  // CAPX and its people.
  "capx", "capximon", "capimon", "nedalabs", "neda", "team", "official", "staff",
  // Anything that reads as the desk talking to you.
  "admin", "administrator", "support", "help", "helpdesk", "service", "security",
  "moderator", "mod", "root", "system", "info", "contact", "billing", "payments",
  "noreply", "no-reply", "alert", "alerts", "notification", "notifications",
  // The counterparties a customer is told to trust.
  "fimco", "ntzs", "dse", "crdb", "nmb", "broker", "custodian", "treasury",
  // Routes, so a handle can never read as a page of the site.
  "api", "login", "signin", "signup", "register", "account", "settings",
  "markets", "portfolio", "verify", "kyc", "wallet", "deposit", "withdraw",
]);

/**
 * What is wrong with an already-cleaned handle, or null if nothing is.
 *
 * Takes the output of cleanUsername: the caller cleans first, so the only
 * failures left are ones no amount of tidying can fix.
 */
export function usernameProblem(cleaned: string): string | null {
  if (cleaned.length < MIN) return `A username needs at least ${MIN} characters.`;
  if (isReserved(cleaned)) return "That username is reserved. Please choose another.";
  return null;
}

/**
 * Is this handle one of the reserved ones?
 *
 * Compared with the separators stripped, so "c.a.p.x" and "capx_" are the
 * same name to this check as "capx" — which is how a reader would see them.
 */
export function isReserved(cleaned: string): boolean {
  const bare = cleaned.replace(/[._-]/g, "");
  return RESERVED.has(cleaned) || RESERVED.has(bare);
}

/**
 * A handle to offer someone who has not chosen one, or whose choice is taken.
 *
 * Built from whatever they have already given — their name, failing that the
 * local part of their email — so the suggestion is recognisably theirs. The
 * `taken` test is passed in because only the caller can reach the database.
 */
export async function suggestUsername(
  seed: string,
  taken: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  const base = cleanUsername(seed.split("@")[0] ?? "");
  if (base.length < MIN) return null;
  // The bare name first, then numbered; a handful of tries is enough, and an
  // unbounded loop against a database is not something to leave in a request.
  for (const candidate of [base, ...Array.from({ length: 20 }, (_, i) => `${base}${i + 2}`)]) {
    // Never offer a name the same rules would then refuse.
    if (isReserved(candidate)) continue;
    if (!(await taken(candidate))) return candidate;
  }
  return null;
}
