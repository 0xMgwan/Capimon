import "server-only";
import { db, dbConfigured, migrate } from "./db";
import { withdrawalQuote } from "./ntzs";
import { omnibusUserId } from "./omnibus";
import { TZ_BANK_CANDIDATES } from "./tzBanks";

/**
 * Asking nTZS which of Selcom's bank codes it accepts.
 *
 * A quote prices a payout and moves nothing — it is the one call that can
 * ask "would you accept this?" without anybody being paid. So each candidate
 * code is quoted with a deliberately unusable account number, and the answer
 * is read for which half it objected to: a complaint about the account means
 * the bank was recognised, a complaint about the bank means it was not.
 *
 * Codes are kept only when the rail recognised them. Everything else is
 * recorded as rejected with what was said, so the list grows from evidence
 * rather than from another round of guessing.
 */
const PROBE_ACCOUNT = "0000000000";
const PROBE_TZS = 5_000;

export type ProbeResult = { code: string; name: string; verdict: "known" | "unknown" | "unclear"; detail: string };

/** Which half of the request did upstream object to? */
function readVerdict(message: string): { verdict: ProbeResult["verdict"]; detail: string } {
  const m = message.toLowerCase();

  // The bank was not recognised. Nothing else matters.
  if (/bank.?code|invalid bank|unknown bank|unsupported bank|bank not|fi code|institution/.test(m)) {
    return { verdict: "unknown", detail: message.slice(0, 140) };
  }
  /*
   * It got as far as the account, which means the bank itself was accepted —
   * the probe account is ten zeroes and is meant to fail exactly here.
   */
  if (/account|recipient|beneficiary|name.?lookup|not found|invalid destination/.test(m)) {
    return { verdict: "known", detail: message.slice(0, 140) };
  }
  // Balance, limits, rate limiting: nothing about the bank either way.
  return { verdict: "unclear", detail: message.slice(0, 140) };
}

/**
 * Probes a slice of the list.
 *
 * In batches because a single pass over forty-odd candidates, spaced under
 * the rate limit, outlives a serverless request — it does not fail so much
 * as never answer, which is what a spinner that sits there forever is. The
 * caller walks through with an offset and sees each batch land.
 */
export async function probeBankCodes(offset = 0, limit = TZ_BANK_CANDIDATES.length): Promise<ProbeResult[]> {
  const userId = await omnibusUserId();
  const out: ProbeResult[] = [];

  for (const candidate of TZ_BANK_CANDIDATES.slice(offset, offset + limit)) {
    try {
      await withdrawalQuote({
        userId, amountTzs: PROBE_TZS,
        bankCode: candidate.code, accountNumber: PROBE_ACCOUNT,
      });
      // A quote that prices at all means the bank is real and reachable.
      out.push({ ...candidate, verdict: "known", detail: "quoted" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "failed";
      out.push({ ...candidate, ...readVerdict(message) });
    }
    // Their lookup is rate limited at 30/min; this stays well inside it.
    await new Promise((r) => setTimeout(r, 1_200));
  }

  return out;
}

/** Saves the codes the rail recognised, so the picker can serve them. */
export async function saveVerifiedBanks(results: ProbeResult[], merge = false): Promise<number> {
  if (!dbConfigured) return 0;

  // Batches arrive one at a time, so each one adds to what is already saved
  // rather than replacing it with its own slice.
  const previous = merge ? await verifiedBanks() : [];
  results = [
    ...previous.map((b) => ({ ...b, verdict: "known" as const, detail: "saved" })),
    ...results,
  ];

  /*
   * One entry per bank.
   *
   * Selcom's list and nTZS's examples disagree on a few — CRDBBANK against
   * CRDB — so both forms are probed and the rail decides. If it takes both,
   * the first is kept: a picker offering the same bank twice under two codes
   * asks the customer a question they have no way to answer.
   */
  const seen = new Set<string>();
  const known = results
    .filter((r) => r.verdict === "known")
    .filter((r) => {
      const key = r.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({ code: r.code, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!known.length) return 0;
  await migrate();
  await db()`
    insert into capx.ops_contacts (party, payout, updated_by, updated_at)
    values ('banks', ${JSON.stringify({ banks: known })}::jsonb, 'probe', now())
    on conflict (party) do update
      set payout = excluded.payout, updated_by = 'probe', updated_at = now()`;
  return known.length;
}

export async function verifiedBanks(): Promise<{ code: string; name: string }[]> {
  if (!dbConfigured) return [];
  try {
    await migrate();
    const [row] = await db()<{ payout: { banks?: { code: string; name: string }[] } | null }[]>`
      select payout from capx.ops_contacts where party = 'banks'`;
    return row?.payout?.banks ?? [];
  } catch {
    return [];
  }
}

/** How many candidates there are, so the desk can show progress. */
export const TOTAL_CANDIDATES = TZ_BANK_CANDIDATES.length;
