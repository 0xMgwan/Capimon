import "server-only";
import { db, migrate } from "./db";
import { placeSecurityOrder } from "./dseOrders";
import { notify } from "./notify";
import type { SessionUser } from "./auth";

/**
 * Standing orders: the same amount into the same share, week after week.
 *
 * This is how people actually accumulate — a little on payday rather than a
 * decision every month — and it is the difference between an app somebody
 * tried once and one they are still using in a year.
 *
 * Two things it deliberately does not do. It never deposits: it spends the
 * shillings already in the account, and if they are not there it says so and
 * waits for the next date rather than half-filling. And it takes no shortcut
 * through the order rules — every run goes through the same path as a person
 * pressing Buy, so a halted market or an unverified account refuses a
 * scheduled order exactly as it refuses a manual one.
 */
export type Cadence = "daily" | "weekly" | "monthly";

export type RecurringBuy = {
  id: string;
  symbol: string;
  amountTzs: number;
  cadence: Cadence;
  dayOf: number;
  nextRun: string;
  status: string;
  lastRunAt: string | null;
  lastError: string | null;
  runs: number;
  misses: number;
};

/** East Africa has no daylight saving, so the offset is a constant. */
const EAT_OFFSET_MS = 3 * 3600_000;

/**
 * The next time this schedule should fire, at 09:00 EAT.
 *
 * Morning, because a buy wants a price the market has had a chance to set,
 * and because somebody who is paid at month end should see it happen while
 * they are awake.
 */
export function nextRunAfter(from: Date, cadence: Cadence, dayOf: number): Date {
  // Work in EAT wall-clock, then hand back an instant.
  const local = new Date(from.getTime() + EAT_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();

  const at = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month, day, 9, 0, 0) - EAT_OFFSET_MS);

  // Daily ignores the day entirely: the next nine o'clock there is.
  if (cadence === "daily") {
    const today = at(y, m, d);
    return today.getTime() > from.getTime() ? today : at(y, m, d + 1);
  }

  if (cadence === "weekly") {
    const want = ((dayOf % 7) + 7) % 7;
    let candidate = at(y, m, d);
    // Step to the wanted weekday, and past today if today's slot has gone.
    for (let i = 0; i < 8; i++) {
      const c = new Date(candidate.getTime() + i * 86_400_000);
      const weekday = new Date(c.getTime() + EAT_OFFSET_MS).getUTCDay();
      if (weekday === want && c.getTime() > from.getTime()) return c;
    }
    candidate = at(y, m, d + 7);
    return candidate;
  }

  // Monthly. Capped at 28 on the way in, so no month is skipped.
  const day = Math.min(Math.max(dayOf, 1), 28);
  const thisMonth = at(y, m, day);
  return thisMonth.getTime() > from.getTime() ? thisMonth : at(y, m + 1, day);
}

export function describe(b: { cadence: string; dayOf: number }): string {
  if (b.cadence === "daily") return "every day";
  if (b.cadence === "weekly") {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return `every ${names[((b.dayOf % 7) + 7) % 7]}`;
  }
  const d = Math.min(Math.max(b.dayOf, 1), 28);
  const suffix = d === 1 || d === 21 ? "st" : d === 2 || d === 22 ? "nd" : d === 3 || d === 23 ? "rd" : "th";
  return `on the ${d}${suffix} of each month`;
}

type Row = {
  id: string; symbol: string; amount_tzs: string; cadence: string; day_of: number;
  next_run: string; status: string; last_run_at: string | null; last_error: string | null;
  runs: number; misses: number;
};

const toBuy = (r: Row): RecurringBuy => ({
  id: r.id, symbol: r.symbol, amountTzs: Number(r.amount_tzs),
  cadence: r.cadence === "monthly" ? "monthly" : r.cadence === "daily" ? "daily" : "weekly",
  dayOf: r.day_of,
  nextRun: r.next_run, status: r.status, lastRunAt: r.last_run_at,
  lastError: r.last_error, runs: r.runs, misses: r.misses,
});

export async function listFor(userId: string): Promise<RecurringBuy[]> {
  await migrate();
  const rows = await db()<Row[]>`
    select id::text, symbol, amount_tzs::text, cadence, day_of, next_run, status,
           last_run_at, last_error, runs, misses
      from capx.recurring_buys where user_id = ${userId}
     order by created_at desc`;
  return rows.map(toBuy);
}

export async function createFor(userId: string, input: {
  symbol: string; amountTzs: number; cadence: Cadence; dayOf: number;
}): Promise<RecurringBuy> {
  await migrate();
  const next = nextRunAfter(new Date(), input.cadence, input.dayOf);
  const [row] = await db()<Row[]>`
    insert into capx.recurring_buys (user_id, symbol, amount_tzs, cadence, day_of, next_run)
    values (${userId}, ${input.symbol}, ${input.amountTzs}, ${input.cadence}, ${input.dayOf}, ${next})
    returning id::text, symbol, amount_tzs::text, cadence, day_of, next_run, status,
              last_run_at, last_error, runs, misses`;
  return toBuy(row);
}

/** Pause, resume or delete — only ever the caller's own. */
export async function updateFor(userId: string, id: string, action: "pause" | "resume" | "cancel"): Promise<boolean> {
  await migrate();
  const sql = db();
  if (action === "cancel") {
    const rows = await sql`delete from capx.recurring_buys where id = ${id}::uuid and user_id = ${userId} returning id`;
    return rows.length > 0;
  }
  if (action === "pause") {
    const rows = await sql`update capx.recurring_buys set status = 'paused'
                            where id = ${id}::uuid and user_id = ${userId} returning id`;
    return rows.length > 0;
  }
  // Resuming re-dates the schedule: a plan that was paused for two months
  // should not wake up believing it owes two buys.
  const [row] = await sql<{ cadence: string; day_of: number }[]>`
    select cadence, day_of from capx.recurring_buys where id = ${id}::uuid and user_id = ${userId}`;
  if (!row) return false;
  const cadence: Cadence = row.cadence === "monthly" ? "monthly" : row.cadence === "daily" ? "daily" : "weekly";
  const next = nextRunAfter(new Date(), cadence, row.day_of);
  await sql`update capx.recurring_buys set status = 'active', next_run = ${next}, last_error = null
             where id = ${id}::uuid and user_id = ${userId}`;
  return true;
}

/**
 * Runs everything that is due.
 *
 * Each schedule is advanced before its order is attempted, so a failure costs
 * one instalment rather than jamming the queue and firing a month of buys the
 * moment it clears. A refusal is recorded on the row and told to the customer;
 * the commonest one by far will be an empty balance, which is not an error so
 * much as a reminder to top up.
 */
export async function runDue(now = new Date()): Promise<{ ran: number; bought: number; skipped: number }> {
  await migrate();
  const sql = db();
  const due = await sql<(Row & { user_id: string })[]>`
    select id::text, user_id::text, symbol, amount_tzs::text, cadence, day_of, next_run, status,
           last_run_at, last_error, runs, misses
      from capx.recurring_buys
     where status = 'active' and next_run <= ${now}
     order by next_run limit 200`;

  let bought = 0, skipped = 0;
  for (const r of due) {
    const b = toBuy(r);
    const next = nextRunAfter(now, b.cadence, b.dayOf);

    const [u] = await sql<{ id: string; email: string; kyc_status: string; name: string | null;
                            username: string | null; phone: string | null; country: string | null;
                            nida_number: string | null }[]>`
      select id::text, email, kyc_status, name, username, phone, country, nida_number
        from capx.users where id = ${r.user_id}::uuid`;
    if (!u) continue;

    // Only the fields the order path reads; this is not a session.
    const user = {
      id: u.id, email: u.email, username: u.username, name: u.name, phone: u.phone,
      country: u.country ?? "TZ", avatar: null, ntzsUserId: null,
      kycStatus: u.kyc_status, nidaNumber: u.nida_number,
    } as SessionUser;

    const result = await placeSecurityOrder(user, { security: b.symbol, side: "buy", amount: b.amountTzs });

    if (result.ok) {
      bought++;
      await sql`update capx.recurring_buys
                   set next_run = ${next}, last_run_at = now(), last_error = null,
                       runs = runs + 1, misses = 0
                 where id = ${b.id}::uuid`;
    } else {
      skipped++;
      await sql`update capx.recurring_buys
                   set next_run = ${next}, last_run_at = now(), last_error = ${result.error.slice(0, 300)},
                       misses = misses + 1
                 where id = ${b.id}::uuid`;
      await notify({
        userId: u.id, kind: "trade", ref: `recurring:${b.id}:${b.nextRun}`, asset: b.symbol,
        title: `Automatic buy of ${b.symbol} did not run`,
        body: result.code === "insufficient_balance"
          ? `Top up and it will try again ${new Date(next).toLocaleDateString("en-GB")}.`
          : result.error.slice(0, 160),
      });
    }
  }
  return { ran: due.length, bought, skipped };
}
