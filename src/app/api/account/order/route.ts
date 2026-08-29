import { NextResponse } from "next/server";
import { db, migrate } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { balanceOf, record } from "@/lib/ledger";
import { BY_SYMBOL } from "@/lib/assets";
import { executeBuy, executeSell, treasuryConfigured } from "@/lib/treasury";
import { requireDb, bad, boom, notConfigured } from "@/lib/apiHelpers";
import { assertSolvent } from "@/lib/solvency";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Places a custodial order: CAPX trades from the omnibus treasury and the
 * ledger records what the user is owed.
 *
 * The order row is written before the trade and settled after, so a crash
 * mid-flight leaves an auditable `pending` order rather than a user's money
 * disappearing with no trace. Ledger entries are keyed to the order id, so a
 * retry cannot double-credit.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  if (!treasuryConfigured) return notConfigured("Custodial trading");

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json();
    const side = body.side === "sell" ? "sell" : "buy";

    // Gate buys, never sells. A buy spends USDC and can deepen a shortfall, so
    // it must not run against under-backed holdings. A sell does the opposite —
    // it returns shares to USDC and can only improve backing — so blocking it
    // would trap a customer's money behind a shortfall they are trying to exit.
    if (side === "buy") {
      try {
        await assertSolvent();
      } catch (e) {
        return NextResponse.json(
          { ok: false, code: "trading_paused", error: e instanceof Error ? e.message : "Trading is paused." },
          { status: 503 },
        );
      }
    }
    const asset = BY_SYMBOL[String(body.symbol ?? "").toLowerCase()];
    const amount = Number(body.amount);
    // A buy is denominated in the currency the account actually holds: a
    // shilling account spends TZS and the swap to USDC happens here, at buy
    // time; a USDC account spends USDC directly.
    const currency = body.currency === "TZS" ? "TZS" : "USDC";
    if (!asset) return bad("Unknown asset.");
    if (!(amount > 0)) return bad("Amount must be greater than zero.");

    // Never let an order exceed what the ledger says the user holds.
    if (side === "buy") {
      if (currency === "TZS") {
        const tzs = await balanceOf(user.id, "TZS");
        if (amount > tzs)
          return bad(`Your balance is ${Math.floor(tzs).toLocaleString()} TZS.`, "insufficient_balance");
      } else {
        const cash = await balanceOf(user.id, "USDC");
        if (amount > cash) return bad(`Your balance is ${cash.toFixed(2)} USDC.`, "insufficient_balance");
      }
    } else {
      const held = await balanceOf(user.id, asset.symbol);
      if (amount > held) return bad(`You hold ${held.toFixed(6)} ${asset.symbol}.`, "insufficient_balance");
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
        userId: user.id, kind: "trade", ref: `order:${orderId}`,
        title: side === "buy"
          ? `Bought ${exec.qty.toFixed(6)} ${asset.ticker}`
          : `Sold ${exec.qty.toFixed(6)} ${asset.ticker}`,
        body: `${side === "buy" ? "Cost" : "Proceeds"} $${exec.usdc.toFixed(2)} at $${exec.price.toFixed(2)}.`,
      });
      return NextResponse.json({ ok: true, orderId, ...exec });
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
        await record([
          { userId: user.id, kind: "adjustment", asset: "TZS", amount: (-swapped.tzsSpent).toString(),
            ref: `${orderId}:unwind-tzs`,
            metadata: { orderId, reason: "order failed after the shilling swap" } },
          { userId: user.id, kind: "adjustment", asset: "USDC", amount: swapped.usdc.toString(),
            ref: `${orderId}:unwind-usdc`,
            metadata: { orderId, reason: "shillings already converted; held as USDC" } },
        ]);
      }
      return NextResponse.json(
        { ok: false, code: "execution_failed", orderId, error: message,
          note: swapped
            ? `Your ${swapped.tzsSpent.toLocaleString()} TZS had already been converted, so it is held as ` +
              `${swapped.usdc.toFixed(2)} USDC in your balance. No shares were bought.`
            : "Nothing was debited from your balance." },
        { status: 502 },
      );
    }
  } catch (e) {
    return boom(e, "Could not place your order");
  }
}
