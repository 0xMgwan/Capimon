import "server-only";
import { db, migrate } from "./db";
import { kycRefusal, type SessionUser } from "./auth";
import { balanceOf, record } from "./ledger";
import { BY_SYMBOL } from "./assets";
import { executeBuy, executeSell, treasuryConfigured } from "./treasury";
import { assertSolvent } from "./solvency";
import { notify } from "./notify";

/**
 * A custodial order in a US equity: CAPX trades from the omnibus treasury and
 * the ledger records what the customer is owed.
 *
 * Lifted out of the route it used to live in, unchanged, so that a standing
 * order can place one too. A scheduler reaching into an HTTP handler to buy
 * shares is not a thing that can be made safe — there is no session to act
 * under and no way to reuse the refusals — and the alternative, a second
 * implementation of the buy path for automatic investing, would be two places
 * to get a money movement right. This is the one place.
 *
 * The order row is written before the trade and settled after, so a crash
 * mid-flight leaves an auditable `pending` order rather than a customer's
 * money disappearing with no trace. Ledger entries are keyed to the order id,
 * so a retry cannot double-credit.
 */
export type UsOrderResult =
  | { ok: true; orderId: string; txHash: string; qty: number; usdc: number; price: number;
      venues: string[]; impact: number }
  | { ok: false; code: string; error: string; orderId?: string; note?: string };

/**
 * Tells the ledger that a customer's shillings became dollars.
 *
 * Written as two adjustments rather than a reversal, because nothing is being
 * reversed: the swap happened and cannot be undone. What is being corrected
 * is the ledger's belief that the money is still shillings.
 *
 * Idempotent by reference. Calling it again writes nothing, which is what
 * lets the failing request try it and the reconciliation pass try it again
 * without either needing to know whether the other succeeded.
 */
export async function unwindSwap(
  userId: string,
  orderId: string,
  tzsSpent: number,
  usdc: number,
): Promise<boolean> {
  const result = await record([
    { userId, kind: "adjustment", asset: "TZS", amount: (-tzsSpent).toString(),
      ref: `${orderId}:unwind-tzs`,
      metadata: { orderId, reason: "order failed after the shilling swap" } },
    { userId, kind: "adjustment", asset: "USDC", amount: usdc.toString(),
      ref: `${orderId}:unwind-usdc`,
      metadata: { orderId, reason: "shillings already converted; held as USDC" } },
  ]);
  return result.written > 0;
}

/**
 * Finishes any unwind that its own request could not.
 *
 * Looks for the specific inconsistency this can leave behind: an order that
 * recorded a shilling swap, did not settle, and has neither the successful
 * trade's cash entry nor the unwind's. Those are the accounts whose ledger
 * claims shillings the omnibus has already converted.
 *
 * Deliberately narrow, and only where the outcome is known.
 *
 * A *failed* order is unambiguous: the trade did not happen, so the money is
 * USDC and saying so is the whole repair. A *pending* one that swapped is
 * not. The process may have died before the trade, in which case the same
 * repair applies — or after it, in which case the shares exist, the treasury
 * is holding them, and crediting USDC as well would invent value out of a
 * crash. Nothing here can tell those apart without reading the chain, so
 * they are reported rather than repaired, and a person looks.
 *
 * It never touches a settled order, never guesses an amount — both come from
 * the order row, written at the moment of the swap — and writes through the
 * same idempotent path, so running it twice, or alongside a retry, costs
 * nothing.
 */
const PENDING_GRACE_MS = 15 * 60_000;

export async function reconcileSwaps(): Promise<{
  fixed: { orderId: string; tzs: number; usdc: number; written: boolean }[];
  needsDesk: { orderId: string; tzs: number; usdc: number; ageMinutes: number }[];
}> {
  await migrate();
  const sql = db();

  /* Missing either leg counts as missing: the pair is written atomically, so
     one present and the other not means something stranger than a crash. */
  const stranded = await sql<{ id: string; user_id: string; swap_tzs: string;
                               swap_usdc: string; status: string; age_ms: string }[]>`
    select o.id::text, o.user_id::text, o.swap_tzs::text, o.swap_usdc::text, o.status,
           (extract(epoch from (now() - o.created_at)) * 1000)::text as age_ms
      from capx.orders o
     where o.swap_tzs is not null
       and o.status <> 'settled'
       and not exists (
         select 1 from capx.ledger_entries l
          where l.ref in (o.id::text || ':cash', o.id::text || ':unwind-tzs'))
     order by o.created_at
     limit 50`;

  const fixed: { orderId: string; tzs: number; usdc: number; written: boolean }[] = [];
  const needsDesk: { orderId: string; tzs: number; usdc: number; ageMinutes: number }[] = [];

  for (const o of stranded) {
    const tzs = Number(o.swap_tzs);
    const usdc = Number(o.swap_usdc);

    if (o.status !== "failed") {
      // Still inside the life of a request that may yet finish on its own.
      if (Number(o.age_ms) < PENDING_GRACE_MS) continue;
      needsDesk.push({ orderId: o.id, tzs, usdc, ageMinutes: Math.round(Number(o.age_ms) / 60000) });
      continue;
    }

    const written = await unwindSwap(o.user_id, o.id, tzs, usdc).catch(() => false);
    fixed.push({ orderId: o.id, tzs, usdc, written });
  }

  if (fixed.length || needsDesk.length) {
    const { sendMail } = await import("./mail");
    await sendMail({
      subject: `CAPX: ${fixed.length} stranded swap(s) completed, ${needsDesk.length} need a person`,
      text: [
        ...fixed.map((d) =>
          `${d.orderId}: ${d.tzs} TZS → ${d.usdc} USDC — ${d.written ? "unwind written" : "STILL FAILING"}`),
        ...(needsDesk.length
          ? ["", "These swapped and then stopped, with the order still pending. Whether the trade",
             "landed is not knowable from the database — check the treasury on Base before",
             "deciding. Crediting USDC for a trade that did happen would invent value.", ""]
          : []),
        ...needsDesk.map((d) =>
          `${d.orderId}: ${d.tzs} TZS → ${d.usdc} USDC, pending ${d.ageMinutes} min`),
      ].join("\n"),
    }).catch(() => { /* the entries are written either way */ });
  }

  return { fixed, needsDesk };
}

export async function placeUsOrder(
  user: SessionUser,
  input: { symbol: string; side: "buy" | "sell"; amount: number; currency?: "TZS" | "USDC" },
): Promise<UsOrderResult> {
  if (!treasuryConfigured) {
    return { ok: false, code: "not_configured", error: "Custodial trading is not configured." };
  }

  const side = input.side === "sell" ? "sell" : "buy";
  const amount = Number(input.amount);
  // A buy is denominated in the currency the account actually holds: a
  // shilling account spends TZS and the swap to USDC happens here, at buy
  // time; a USDC account spends USDC directly.
  const currency = input.currency === "TZS" ? "TZS" : "USDC";

  // Unverified accounts may close a position but not open one.
  if (side === "buy") {
    const refusal = kycRefusal(user, "buy");
    if (refusal) return { ok: false, code: refusal.code, error: refusal.error };
  }

    // Gate buys, never sells. A buy spends USDC and can deepen a shortfall, so
    // it must not run against under-backed holdings. A sell does the opposite —
    // it returns shares to USDC and can only improve backing — so blocking it
    // would trap a customer's money behind a shortfall they are trying to exit.
    if (side === "buy") {
      try {
        await assertSolvent();
      } catch (e) {
        return { ok: false as const, code: "trading_paused",
                 error: e instanceof Error ? e.message : "Trading is paused." };
      }
    }
    const asset = BY_SYMBOL[input.symbol.toLowerCase()];
    if (!asset) return { ok: false as const, code: "bad_request", error: "Unknown asset." };
    if (!(amount > 0)) {
      return { ok: false as const, code: "bad_request", error: "Amount must be greater than zero." };
    }

    // Never let an order exceed what the ledger says the user holds.
    if (side === "buy") {
      if (currency === "TZS") {
        const tzs = await balanceOf(user.id, "TZS");
        if (amount > tzs)
          return { ok: false as const, code: "insufficient_balance",
                   error: `Your balance is ${Math.floor(tzs).toLocaleString()} TZS.` };
      } else {
        const cash = await balanceOf(user.id, "USDC");
        if (amount > cash) {
          return { ok: false as const, code: "insufficient_balance",
                   error: `Your balance is ${cash.toFixed(2)} USDC.` };
        }
      }
    } else {
      const held = await balanceOf(user.id, asset.symbol);
      if (amount > held) {
        return { ok: false as const, code: "insufficient_balance",
                 error: `You hold ${held.toFixed(6)} ${asset.symbol}.` };
      }
    }

    await migrate();
    const sql = db();
    const orders = await sql<{ id: string }[]>`
      insert into capx.orders (user_id, side, symbol, usdc_amount, qty)
      values (${user.id}, ${side}, ${asset.symbol},
              ${side === "buy" && currency === "USDC" ? amount : null}, ${side === "sell" ? amount : null})
      returning id`;
    const orderId = orders[0].id;

    // Set once the shillings have actually been converted, so a failure after
    // that point can still account for money that really moved.
    let swapped: { usdc: number; tzsSpent: number } | null = null;

    try {
      // A shilling buy converts exactly the spent TZS into USDC first, then
      // sizes the trade to what actually arrived — so the debit is the TZS the
      // user chose and the shares are what that bought at today's rate.
      let tzsSpent = 0;
      let exec;
      if (side === "buy" && currency === "TZS") {
        const { swapTzsToUsdc } = await import("@/lib/ntzsFunding");
        const converted = await swapTzsToUsdc(amount);
        tzsSpent = converted.tzsSpent;
        swapped = converted;

        /*
         * Written down before anything else can go wrong.
         *
         * From here the shillings are gone from the omnibus and the ledger
         * has not been told. Everything between this line and the entries
         * below — the trade, the ledger write, the process itself — can
         * fail, and until now all of it failing meant the swap was
         * unrecoverable: the only record of it was a local variable in a
         * request that was already dying. One UPDATE closes that to the few
         * milliseconds either side of this statement, and `reconcileSwaps`
         * can finish anything that falls in it.
         */
        await sql`
          update capx.orders
             set swap_tzs = ${converted.tzsSpent}, swap_usdc = ${converted.usdc}
           where id = ${orderId}`;

        /*
         * Never buy more than the customer paid for.
         *
         * The trade is sized from the swap's output, so anything that
         * overstates that output buys shares nobody funded — and the ledger
         * debits the shillings either way, so the difference comes out of
         * everyone else's backing. A second, independent ceiling from the live
         * rate means one bad reading cannot become a hole in the book.
         */
        const { getSwapRate } = await import("@/lib/ntzs");
        const ceilingQuote = await getSwapRate("NTZS", "USDC", Math.max(1, Math.round(amount)))
          .then((r) => Number(r.expectedOutput ?? 0))
          .catch(() => 0);
        if (ceilingQuote > 0 && converted.usdc > ceilingQuote * 1.05) {
          throw new Error(
            `Refusing to spend ${converted.usdc.toFixed(6)} USDC for ${amount.toLocaleString()} TZS, ` +
            `which is worth about ${ceilingQuote.toFixed(6)}. Nothing was traded.`,
          );
        }

        exec = await executeBuy(asset.symbol, converted.usdc);
      } else {
        exec = side === "buy" ? await executeBuy(asset.symbol, amount)
                              : await executeSell(asset.symbol, amount);
      }

      await record(
        side === "buy"
          ? [
              currency === "TZS"
                ? { userId: user.id, kind: "buy", asset: "TZS", amount: (-tzsSpent).toString(), ref: `${orderId}:cash`,
                    metadata: { orderId, txHash: exec.txHash, usdc: exec.usdc } }
                : { userId: user.id, kind: "buy", asset: "USDC", amount: (-exec.usdc).toString(), ref: `${orderId}:cash`,
                    metadata: { orderId, txHash: exec.txHash } },
              { userId: user.id, kind: "buy", asset: asset.symbol, amount: exec.qty.toString(), ref: `${orderId}:asset`,
                metadata: { orderId, txHash: exec.txHash, price: exec.price } },
            ]
          : [
              // Price on the share leg as well as the cash leg: cost basis is
              // read from the share entries, and joining back through the order
              // to find a number we already had is needless indirection.
              { userId: user.id, kind: "sell", asset: asset.symbol, amount: (-exec.qty).toString(), ref: `${orderId}:asset`,
                metadata: { orderId, txHash: exec.txHash, price: exec.price } },
              { userId: user.id, kind: "sell", asset: "USDC", amount: exec.usdc.toString(), ref: `${orderId}:cash`,
                metadata: { orderId, txHash: exec.txHash, price: exec.price } },
            ],
      );

      await sql`
        update capx.orders set status = 'settled', tx_hash = ${exec.txHash}, price = ${exec.price},
               qty = ${exec.qty}, usdc_amount = ${exec.usdc}, settled_at = now()
         where id = ${orderId}`;

      await notify({
        userId: user.id, kind: "trade", ref: `order:${orderId}`, asset: asset.symbol,
        title: side === "buy"
          ? `Bought ${exec.qty.toFixed(6)} ${asset.ticker}`
          : `Sold ${exec.qty.toFixed(6)} ${asset.ticker}`,
        body: `${side === "buy" ? "Cost" : "Proceeds"} $${exec.usdc.toFixed(2)} at $${exec.price.toFixed(2)}.`,
      });
      return { ok: true as const, orderId, ...exec };
    } catch (e) {
      const raw = e instanceof Error ? e.message : "execution failed";
      /*
       * Keep the reason, drop the transport noise. A viem revert carries the
       * whole request — including an unbroken calldata blob — which tells a
       * customer nothing and, having no spaces to wrap at, stretches the page
       * sideways on a phone. The full error is still on the order row.
       */
      const message = raw
        .split(/\n\s*\n/)[0]
        .replace(/0x[0-9a-fA-F]{40,}/g, "")
        .replace(/\s*Version:\s*viem@[\d.]+/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
      await sql`update capx.orders set status = 'failed', error = ${raw.slice(0, 2000)} where id = ${orderId}`;

      /*
       * The swap is irreversible. If the shillings were converted and only the
       * trade failed, the customer's money is now USDC — so record that, rather
       * than leaving their balance claiming shillings the omnibus no longer
       * holds. Saying "nothing was debited" while the TZS is gone is how a
       * failed order turns into an unbacked liability.
       */
      if (swapped) {
        /*
         * The unwind must not be able to fail silently.
         *
         * `record` swallows a duplicate reference and rethrows everything
         * else, so any other database trouble used to propagate out of this
         * catch block — past the return below — and leave the order marked
         * failed with the shillings gone and the ledger still claiming them.
         * The one path whose whole purpose is to prevent an unbacked
         * liability was the one path that could create one.
         *
         * Now it is attempted, and a failure is reported rather than thrown:
         * the row carries what was swapped, `reconcileSwaps` will complete
         * it on the next tick, and the desk is told at once because this is
         * real money in the wrong column until then.
         */
        await unwindSwap(user.id, orderId, swapped.tzsSpent, swapped.usdc)
          .catch(async (unwindError: unknown) => {
            const why = unwindError instanceof Error ? unwindError.message : "unknown";
            await sql`
              update capx.orders
                 set error = coalesce(error, '') || ${`\n[unwind failed] ${why}`}
               where id = ${orderId}`.catch(() => {});
            const { sendMail } = await import("./mail");
            await sendMail({
              subject: `CAPX: order ${orderId} swapped but could not be unwound`,
              text:
                `A shilling buy converted ${swapped!.tzsSpent} TZS into ${swapped!.usdc} USDC and then ` +
                `failed to trade. Writing the unwind to the ledger also failed.\n\n` +
                `Reason: ${why}\n\n` +
                `Until it is written, this account's ledger claims shillings the omnibus no longer ` +
                `holds. The amounts are on the order row (swap_tzs, swap_usdc) and the next ` +
                `reconcileSwaps run will complete it. Check that it does.`,
            }).catch(() => {});
          });
      }
      return {
        ok: false as const, code: "execution_failed", orderId, error: message,
        note: swapped
          ? `Your ${swapped.tzsSpent.toLocaleString()} TZS had already been converted, so it is held as ` +
            `${swapped.usdc.toFixed(2)} USDC in your balance. No shares were bought.`
          : "Nothing was debited from your balance.",
      };
    }
}
