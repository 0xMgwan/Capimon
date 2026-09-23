import "server-only";
import { db, migrate } from "./db";
import { balanceOf, record } from "./ledger";
import { assertSolvent } from "./solvency";
import { notify } from "./notify";
import { dseMarket, quoteBuyTzs, quoteSellQty, sellQtyOrAll } from "./dseTrading";
import { kycRefusal, type SessionUser } from "./auth";

/**
 * Placing an order in a tokenised DSE share, in one place.
 *
 * This used to live inside the route handler, which was fine while a person
 * pressing a button was the only way an order could happen. A recurring buy
 * is the second way, and it has to pass through exactly the same refusals —
 * the halt, the KYC gate, the solvency check, the inventory ceiling. A
 * scheduled order that skipped any of them would be a hole in the invariant
 * the desk exists to protect, opened for the convenience of a cron job.
 *
 * So the rules live here and both callers use them. The route turns the
 * result into a response; the scheduler turns it into a retry or a notice.
 */
export type OrderRefusal = {
  ok: false;
  code: string;
  error: string;
  /** What the HTTP route should answer with. */
  status: number;
  /** Set when the order row exists but execution failed after it was written. */
  orderId?: string;
  note?: string;
};

export type OrderDone = {
  ok: true;
  orderId: string;
  qty: number;
  tzs: number;
  price: number;
  fee: number;
  feeBps: number;
};

export async function placeSecurityOrder(
  user: SessionUser,
  input: { security: string; side: "buy" | "sell"; amount: number },
): Promise<OrderDone | OrderRefusal> {
  const { side, amount } = input;
  const bad = (error: string, code = "bad_request", status = 400): OrderRefusal =>
    ({ ok: false, code, error, status });

  if (!(amount > 0)) return bad("Amount must be greater than zero.");

  const market = await dseMarket(input.security);
  if (!market) return bad("That security is not listed on CAPX.", "unknown_security");
  const SEC = market.symbol;

  if (!market.tradable) {
    return bad(market.haltReason ?? `${SEC} is not tradable right now.`, "market_halted", 503);
  }

  /*
   * A venue that does not buy back yet. A tokenised IPO can be subscribed to
   * and not sold until allocation completes, and accepting a sell would credit
   * shillings for something CAPX cannot turn back into money.
   */
  if (side === "sell" && market.buyOnly) {
    return bad(
      `${SEC} cannot be sold yet. ${market.issuer ?? "The issuer"} opens selling once the offer closes and allocation completes.`,
      "sell_closed", 409);
  }

  if (side === "buy") {
    // Unverified accounts may close a position but not open one.
    const refusal = kycRefusal(user, "buy");
    if (refusal) return { ok: false, ...refusal, status: 403 };

    /*
     * Gate buys, never sells — a sell returns shares and can only improve
     * backing, so blocking it would trap a customer behind a shortfall they
     * are trying to exit.
     */
    try {
      await assertSolvent();
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Trading is paused.", "trading_paused", 503);
    }
  }

  /*
   * A sell that would leave dust takes the rest with it: selling by a shilling
   * amount almost never lands on a round number of shares.
   */
  const held = side === "sell" ? await balanceOf(user.id, SEC) : 0;
  const quote = side === "buy"
    ? quoteBuyTzs(market.price, amount)                       // amount is shillings
    : quoteSellQty(market.price, sellQtyOrAll(amount, held)); // amount is shares

  if (!(quote.qty > 0)) {
    return bad(side === "buy"
      ? `That is not enough to buy a fraction of a share at ${market.price.toLocaleString()} TZS.`
      : "That quantity rounds to nothing.");
  }

  if (side === "buy") {
    const tzs = await balanceOf(user.id, "TZS");
    if (quote.tzs > tzs) {
      return bad(`Your balance is ${Math.floor(tzs).toLocaleString()} TZS.`, "insufficient_balance");
    }
    /*
     * Never sell a share the treasury does not hold. Availability is custody
     * minus what clients are already owed, read from the chain rather than
     * from our own sales record — the ledger cannot vouch for itself.
     */
    if (quote.qty > market.availableShares) {
      return bad(
        `Only ${market.availableShares} ${SEC} ${market.availableShares === 1 ? "share is" : "shares are"} available. ` +
        `The rest of the custody position is already spoken for.`,
        "insufficient_inventory");
    }
  } else if (quote.qty > held) {
    return bad(`You hold ${held} ${SEC}.`, "insufficient_balance");
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

    await sql`update capx.orders set status = 'settled', settled_at = now() where id = ${orderId}`;

    /*
     * The broker's share of the fee just charged.
     *
     * Recorded against the order that produced it, after the trade is
     * settled: the customer's money is the thing that must not be got wrong,
     * and the split is an accounting entry on our own side. It never throws,
     * and it is keyed to the order so a retry cannot pay twice.
     */
    if (quote.fee > 0) {
      const { accrueBrokerFee } = await import("./brokerLedger");
      await accrueBrokerFee({ orderId, security: SEC, fee: quote.fee });
    }

    await notify({
      userId: user.id, kind: "trade", ref: `order:${orderId}`, asset: SEC,
      title: `${side === "buy" ? "Bought" : "Sold"} ${quote.qty} ${SEC}`,
      body: `${side === "buy" ? "Cost" : "Proceeds"} ${quote.tzs.toLocaleString()} TZS at ${quote.price.toLocaleString()} TZS a share.`,
    });

    return { ok: true, orderId, ...quote };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "order failed";
    await sql`update capx.orders set status = 'failed', error = ${raw.slice(0, 2000)} where id = ${orderId}`;
    return {
      ok: false, code: "execution_failed", orderId, status: 502,
      error: raw.slice(0, 300),
      note: "Nothing was debited from your balance.",
    };
  }
}
