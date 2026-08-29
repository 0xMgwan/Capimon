/**
 * The password rule, in one place.
 *
 * The server must enforce it and the form must be able to state it before an
 * attempt is made — and a rule copied into both drifts. This module is
 * deliberately free of server-only imports so a client component can read the
 * same function the API validates with.
 *
 * Passwords guarding custody of other people's assets deserve a real floor.
 */
export const PASSWORD_HINT = "10+ characters, letters and numbers";

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Use at least one letter and one number.";
  }
  return null;
}
