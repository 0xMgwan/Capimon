import { NextResponse } from "next/server";
import { db, migrate } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { balanceOf, record } from "@/lib/ledger";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { assertSolvent } from "@/lib/solvency";
import { notify } from "@/lib/notify";
import { dseMarket, quoteBuyTzs, quoteSellQty, sellQtyOrAll } from "@/lib/dseTrading";
import { CRDBT_SECURITY } from "@/lib/assets";

export const dynamic = "force-dynamic";

/**
 * An order in a tokenised DSE share: CRDB, NMB, or whatever is registered.
 * `security` defaults to CRDB so clients written before other listings keep
 * working.
 *
 * Deliberately not routed through the US equities path. That one exists to
 * convert shillings into dollars and sign a swap; here the customer's currency
 * is already the settlement currency and the treasury already holds the shares,
 * so an order is two ledger entries against a position that exists. Forcing it
 * through the other path would mean inventing a swap in order to undo it.
 *
 * The order row is written before the entries and settled after, so a crash
 * mid-flight leaves an auditable row rather than a silent gap, and the entries
 * are keyed to the order id so a retry cannot double-credit.
 */
export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;

  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ ok: false, code: "unauthenticated" }, { status: 401 });

    const body = await req.json();
    const side = body.side === "sell" ? "sell" : "buy";
    const amount = Number(body.amount);
    if (!(amount > 0)) return bad("Amount must be greater than zero.");

    const market = await dseMarket(String(body.security ?? CRDBT_SECURITY));
    if (!market) return bad("That security is not listed on CAPX.", "unknown_security");
    const SEC = market.symbol;
    if (!market.tradable) {
      return NextResponse.json(
        { ok: false, code: "market_halted", error: market.haltReason ?? `${SEC} is not tradable right now.` },
        { status: 503 },
      );
    }

    // Gate buys, never sells — a sell returns shares and can only improve
    // backing, so blocking it would trap a customer behind a shortfall they are
    // trying to exit.
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

    /*
     * A sell that would leave dust takes the rest with it.
     *
     * Selling by a shilling amount almost never lands on a round number of
     * shares, so "sell everything" left a few millionths behind that priced to
     * nothing and could not be sold for anything. It is cleaner to close the
     * position than to leave a row that looks like a holding and is not.
     */
    const held = side === "sell" ? await balanceOf(user.id, SEC) : 0;
    const quote = side === "buy"
      ? quoteBuyTzs(market.price, amount)                       // amount is shillings
      : quoteSellQty(market.price, sellQtyOrAll(amount, held)); // amount is shares

    if (!(quote.qty > 0)) {
      return bad(
        side === "buy"
          ? `That is not enough to buy a fraction of a share at ${market.price.toLocaleString()} TZS.`
          : "That quantity rounds to nothing.",
      );
    }

    if (side === "buy") {
      const tzs = await balanceOf(user.id, "TZS");
      if (quote.tzs > tzs) {
        return bad(`Your balance is ${Math.floor(tzs).toLocaleString()} TZS.`, "insufficient_balance");
      }
      /*
       * Never sell a share the treasury does not hold.
       *
       * Availability is custody minus what clients are already owed, read from
       * the chain rather than from our own sales record — the ledger cannot
       * vouch for itself, and this is the invariant the whole system exists to
       * keep.
       */
      if (quote.qty > market.availableShares) {
        return bad(
          `Only ${market.availableShares} ${SEC} ${market.availableShares === 1 ? "share is" : "shares are"} available. ` +
          `The rest of the custody position is already spoken for.`,
          "insufficient_inventory",
        );
      }
    } else {
      if (quote.qty > held) {
        return bad(`You hold ${held} ${SEC}.`, "insufficient_balance");
      }
    }

    await migrate();
    const sql = db();
    const orders = await sql<{ id: string }[]>`
      insert into capx.orders (user_id, side, symbol, qty, price)
      values (${user.id}, ${side}, ${SEC}, ${quote.qty}, ${quote.price})
      returning id`;
    const orderId = orders[0].id;

    try {
      await record(
        side === "buy"
          ? [
              { userId: user.id, kind: "buy", asset: "TZS", amount: (-quote.tzs).toString(),
                ref: `${orderId}:cash`,
                metadata: { orderId, price: quote.price, fee: quote.fee, feeBps: quote.feeBps } },
              { userId: user.id, kind: "buy", asset: SEC, amount: quote.qty.toString(),
                ref: `${orderId}:asset`,
                metadata: { orderId, price: quote.price, currency: "TZS" } },
            ]
          : [
              { userId: user.id, kind: "sell", asset: SEC, amount: (-quote.qty).toString(),
                ref: `${orderId}:asset`,
                metadata: { orderId, price: quote.price, currency: "TZS" } },
              { userId: user.id, kind: "sell", asset: "TZS", amount: quote.tzs.toString(),
                ref: `${orderId}:cash`,
                metadata: { orderId, price: quote.price, fee: quote.fee, feeBps: quote.feeBps } },
            ],
      );

      await sql`
        update capx.orders set status = 'settled', settled_at = now()
         where id = ${orderId}`;

      await notify({
        userId: user.id, kind: "trade", ref: `order:${orderId}`, asset: SEC,
        title: `${side === "buy" ? "Bought" : "Sold"} ${quote.qty} ${SEC}`,
        body: `${side === "buy" ? "Cost" : "Proceeds"} ${quote.tzs.toLocaleString()} TZS at ${quote.price.toLocaleString()} TZS a share.`,
      });

      return NextResponse.json({ ok: true, orderId, ...quote });
    } catch (e) {
      const raw = e instanceof Error ? e.message : "order failed";
      await sql`update capx.orders set status = 'failed', error = ${raw.slice(0, 2000)} where id = ${orderId}`;
      return NextResponse.json(
        { ok: false, code: "execution_failed", orderId, error: raw.slice(0, 300),
          note: "Nothing was debited from your balance." },
        { status: 502 },
      );
    }
  } catch (e) {
    return boom(e, "Could not place your order");
  }
}
