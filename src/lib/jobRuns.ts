import "server-only";
import { db, dbConfigured, migrate } from "./db";

/**
 * The heartbeat of the scheduled jobs.
 *
 * A cron that is not firing and a cron that is firing and finding nothing to
 * do are indistinguishable from outside: both produce no orders, no emails
 * and no notifications. Recording every run — including the empty ones —
 * turns "is the scheduler even running?" from a guess into a timestamp.
 *
 * Never throws. A job must not fail because its diary entry could not be
 * written.
 */
export async function recordRun(job: string, ok: boolean, detail: unknown): Promise<void> {
  if (!dbConfigured) return;
  try {
    await migrate();
    await db()`
      insert into capx.job_runs (job, ran_at, ok, detail)
      values (${job}, now(), ${ok}, ${JSON.stringify(detail ?? {})}::jsonb)
      on conflict (job) do update
        set ran_at = now(), ok = excluded.ok, detail = excluded.detail`;
  } catch { /* the job itself is what matters */ }
}

export type JobRun = { job: string; ranAt: string; ok: boolean; detail: Record<string, unknown> };

export async function recentRuns(): Promise<JobRun[]> {
  if (!dbConfigured) return [];
  try {
    await migrate();
    const rows = await db()<{ job: string; ran_at: string; ok: boolean; detail: Record<string, unknown> }[]>`
      select job, ran_at, ok, detail from capx.job_runs order by ran_at desc`;
    return rows.map((r) => ({ job: r.job, ranAt: r.ran_at, ok: r.ok, detail: r.detail ?? {} }));
  } catch {
    return [];
  }
}
