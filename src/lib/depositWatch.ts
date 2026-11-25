import "server-only";
import { after } from "next/server";
import { db, migrate } from "./db";

/**
 * Watching a mobile money collection for the minute somebody is standing
 * there waiting for it.
 *
 * A stablecoin transfer into the omnibus is credited the moment it is seen,
 * because the money is already on the chain and the transaction is its own
 * evidence. A collection is not like that: nothing happens until the customer
 * approves a prompt on their handset, and the only way CAPX learns they did
 * is by asking nTZS.
 *
 * Until now the only things that asked were the ten-minute cron and a partner
 * reading `GET /v1/deposits`. A partner that wired up the webhook instead —
 * which is what the docs tell them to do — had nobody asking at all, so a
 * payment approved in fifteen seconds sat uncredited until the next sweep.
 * That is the difference between "instant" and "taking forever", and none of
 * it was the customer's money moving slowly.
 *
 * So the collection is watched from here, for about as long as a person will
 * hold a phone. It stops the moment the deposit reaches a terminal state,
 * which is almost always the second or third look.
 *
 * This is not a shortcut around confirmation. Every pass is the same
 * settlement the cron runs: nTZS still has to say the money arrived, and
 * asking sooner cannot change the answer. All it does is stop us finding out
 * late.
 */

/* Roughly ninety seconds in total, closer together at the start because that
   is when a prompt is answered. A payment that takes longer than this is no
   longer one somebody is watching, and the cron has it. */
const PASSES = [4_000, 6_000, 8_000, 10_000, 12_000, 15_000, 15_000, 20_000];

const TERMINAL = new Set(["settled", "failed", "duplicate"]);

/**
 * A bank transfer is not watched, and should not be.
 *
 * Nothing is prompted and nothing is pulled: the customer types a reference
 * into their banking app in their own time, and the reference stays good for
 * seventy-two hours. Polling nTZS for ninety seconds about a transfer that has
 * not been made yet asks a dozen questions to learn nothing.
 */
const WATCHED = new Set(["mobile_money", "ramp", "treasury", "omnibus-wallet"]);

export function watchCollection(userId: string, depositId: string, route?: string): void {
  if (route === "bank") return;
  if (route && !WATCHED.has(route)) return;
  after(async () => {
    try {
      const { settlePending } = await import("@/app/api/ntzs/settle/route");
      await migrate();
      const sql = db();

      for (const wait of PASSES) {
        await new Promise((r) => setTimeout(r, wait));
        await settlePending(userId).catch(() => null);
        const [row] = await sql<{ status: string }[]>`
          select status from capx.deposits where id = ${depositId}::uuid`;
        /* A row that has gone (or never existed) ends the watch as surely as
           one that settled — there is nothing left to wait for either way. */
        if (!row || TERMINAL.has(row.status)) return;
      }
    } catch {
      /* The cron is the backstop and always has been. A watcher that threw
         must not take the response down with it, and by here the response is
         already sent. */
    }
  });
}
