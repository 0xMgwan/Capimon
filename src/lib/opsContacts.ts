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

/**
 * Where a party is paid.
 *
 * Mobile money or a bank account, kept as they entered it, with the name it
 * is held in so a payment can be checked before it is sent. Only ever set by
 * the party themselves.
 */
export type PayoutDestination = {
  method: "mobile" | "bank";
  phoneNumber?: string;
  bankCode?: string;
  accountNumber?: string;
  accountName?: string;
};

export async function payoutFor(party: Party): Promise<PayoutDestination | null> {
  if (!dbConfigured) return null;
  try {
    await migrate();
    const [row] = await db()<{ payout: PayoutDestination | null }[]>`
      select payout from capx.ops_contacts where party = ${party}`;
    return row?.payout ?? null;
  } catch {
    return null;
  }
}

export async function setPayout(party: Party, dest: PayoutDestination | null, by: string): Promise<void> {
  await migrate();
  await db()`
    insert into capx.ops_contacts (party, payout, updated_by, updated_at)
    values (${party}, ${dest ? JSON.stringify(dest) : null}::jsonb, ${by}, now())
    on conflict (party) do update
      set payout = excluded.payout, updated_by = excluded.updated_by, updated_at = now()`;
}

/** Tidies a destination, or says what is missing. */
export function parsePayout(raw: unknown): PayoutDestination | { error: string } {
  const d = (raw ?? {}) as Record<string, unknown>;
  const method = d.method === "bank" ? "bank" : "mobile";
  if (method === "bank") {
    const bankCode = String(d.bankCode ?? "").trim().toUpperCase();
    const accountNumber = String(d.accountNumber ?? "").replace(/[^\d]/g, "");
    if (!/^[A-Z0-9_]{2,16}$/.test(bankCode)) return { error: "Choose a bank." };
    if (accountNumber.length < 6) return { error: "Enter the account number." };
    return { method, bankCode, accountNumber, accountName: String(d.accountName ?? "").trim().slice(0, 80) || undefined };
  }
  const phoneNumber = String(d.phoneNumber ?? "").replace(/[^\d]/g, "");
  if (phoneNumber.length < 9) return { error: "Enter the mobile money number." };
  return { method, phoneNumber, accountName: String(d.accountName ?? "").trim().slice(0, 80) || undefined };
}

export async function setContacts(party: Party, emails: string[], by: string): Promise<void> {
  await migrate();
  await db()`
    insert into capx.ops_contacts (party, emails, updated_by, updated_at)
    values (${party}, ${JSON.stringify(emails)}::jsonb, ${by}, now())
    on conflict (party) do update
      set emails = excluded.emails, updated_by = excluded.updated_by, updated_at = now()`;
}
