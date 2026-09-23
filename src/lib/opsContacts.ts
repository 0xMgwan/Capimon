import "server-only";
import { db, dbConfigured, migrate } from "./db";

/**
 * Where a counterparty wants to hear from us.
 *
 * FIMCO files attestations and asks for mints; CAPX approves or refuses them.
 * Until now that answer only existed on a page FIMCO had to think to open,
 * which is the same gap the notices to CAPX closed in the other direction. A
 * broker whose filing was rejected should learn it from their inbox, not from
 * noticing a status chip three days later.
 *
 * Kept as a row per party rather than an environment variable so FIMCO can
 * change their own addresses without a deploy — the people who read the mail
 * are the ones who should decide where it goes.
 */
export type Party = "fimco";

/** One address per line or comma, tidied into a list we can actually send to. */
export function parseEmails(raw: string): { emails: string[]; rejected: string[] } {
  const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  const emails: string[] = [];
  const rejected: string[] = [];
  for (const p of parts) {
    // Deliberately loose. A strict pattern refuses addresses that work, and
    // the real test of an address is whether mail to it arrives.
    if (/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(p) && p.length <= 254) {
      if (!emails.some((e) => e.toLowerCase() === p.toLowerCase())) emails.push(p);
    } else {
      rejected.push(p);
    }
  }
  // A cap, so one paste cannot turn a notice into a mailing list.
  return { emails: emails.slice(0, 10), rejected };
}

export async function contactsFor(party: Party): Promise<string[]> {
  if (!dbConfigured) return [];
  try {
    await migrate();
    const [row] = await db()<{ emails: string[] }[]>`
      select emails from capx.ops_contacts where party = ${party}`;
    return Array.isArray(row?.emails) ? row.emails.filter((e) => typeof e === "string") : [];
  } catch {
    // A notice that cannot find its address is not a reason to fail the
    // decision that triggered it.
    return [];
  }
}

export async function setContacts(party: Party, emails: string[], by: string): Promise<void> {
  await migrate();
  await db()`
    insert into capx.ops_contacts (party, emails, updated_by, updated_at)
    values (${party}, ${JSON.stringify(emails)}::jsonb, ${by}, now())
    on conflict (party) do update
      set emails = excluded.emails, updated_by = excluded.updated_by, updated_at = now()`;
}
