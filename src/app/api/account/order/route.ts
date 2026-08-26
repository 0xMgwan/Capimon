import { NextResponse } from "next/server";
import { db, migrate } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { balanceOf, record } from "@/lib/ledger";
import { BY_SYMBOL } from "@/lib/assets";
import { executeBuy, executeSell, treasuryConfigured } from "@/lib/treasury";
import { requireDb, bad, boom, notConfigured } from "@/lib/apiHelpers";
import { assertSolvent } from "@/lib/solvency";

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

    // Refuse to trade at all if client assets are not fully backed. A shortfall
    // must never be deepened by another order.
    try {
      await assertSolvent();
    } catch (e) {
      return NextResponse.json(
        { ok: false, code: "trading_paused", error: e instanceof Error ? e.message : "Trading is paused." },
        { status: 503 },
      );
    }

    const body = await req.json();
    const side = body.side === "sell" ? "sell" : "buy";
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
              { userId: user.id, kind: "sell", asset: asset.symbol, amount: (-exec.qty).toString(), ref: `${orderId}:asset`,
                metadata: { orderId, txHash: exec.txHash } },
              { userId: user.id, kind: "sell", asset: "USDC", amount: exec.usdc.toString(), ref: `${orderId}:cash`,
                metadata: { orderId, txHash: exec.txHash, price: exec.price } },
            ],
      );

      await sql`
        update capx.orders set status = 'settled', tx_hash = ${exec.txHash}, price = ${exec.price},
               qty = ${exec.qty}, usdc_amount = ${exec.usdc}, settled_at = now()
         where id = ${orderId}`;

      return NextResponse.json({ ok: true, orderId, ...exec });
    } catch (e) {
      const message = e instanceof Error ? e.message : "execution failed";
      await sql`update capx.orders set status = 'failed', error = ${message} where id = ${orderId}`;
      return NextResponse.json(
        { ok: false, code: "execution_failed", orderId, error: message,
          note: "Nothing was debited from your balance." },
        { status: 502 },
      );
    }
  } catch (e) {
    return boom(e, "Could not place your order");
  }
}
