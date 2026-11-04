import "server-only";
import type { SessionUser } from "./auth";

/**
 * One order, whichever board the security belongs to.
 *
 * The choice between Dar es Salaam and New York is made from the symbol and
 * nothing else, and it is made in one place. The partner endpoint and the
 * buy-on-arrival path both come through here, so an order placed by a partner
 * directly and the same order executed a minute later when their transfer
 * went final cannot take different routes or hit different refusals.
 */

export type OrderRequest = {
  security: string;
  side?: "buy" | "sell";
  /** Shillings on a DSE buy; shares on a sell; the named currency on a US buy. */
  amount: number;
  currency?: "TZS" | "USDC";
};

export type OrderResult =
  | { ok: true; orderId: string; qty: number; price: number; amount: number;
      currency: string; venue: "DSE" | "US"; fee: number | null;
      /* A US fee is taken in dollars inside the swap even when the order was
         paid for in shillings, so the currency is stated rather than assumed
         to match the order's. */
      feeCurrency: string; feeBps: number }
  | { ok: false; code: string; error: string; status: number };

export async function placeOrderFor(
  user: SessionUser, input: OrderRequest,
): Promise<OrderResult> {
  const security = input.security.trim().toUpperCase();
  const side = input.side === "sell" ? "sell" : "buy";
  const currency = String(input.currency ?? "TZS").toUpperCase() === "USDC" ? "USDC" : "TZS";

  if (!security) {
    return { ok: false, code: "security_required", error: "Name the security.", status: 400 };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, code: "bad_amount", error: "Amount must be positive.", status: 400 };
  }

  const { dseSecurities } = await import("./dseSecurities");
  const dse = await dseSecurities().catch(() => []);
  const isDse = dse.some((d) => d.symbol.toUpperCase() === security);

  const result = isDse
    ? await (await import("./dseOrders")).placeSecurityOrder(user,
        { security, side, amount: input.amount })
    : await (await import("./usOrders")).placeUsOrder(user,
        { symbol: security, side, amount: input.amount, currency });

  if (!result.ok) {
    const r = result as { code?: string; error?: string; status?: number };
    return { ok: false, code: r.code ?? "order_failed",
      error: r.error ?? "The order did not go through.", status: r.status ?? 400 };
  }

  return {
    ok: true,
    orderId: result.orderId,
    qty: result.qty,
    price: result.price,
    amount: "tzs" in result ? result.tzs : result.usdc,
    currency: isDse ? "TZS" : currency,
    venue: isDse ? "DSE" : "US",
    fee: "fee" in result ? result.fee : null,
    feeCurrency: isDse ? "TZS" : "USDC",
    feeBps: "feeBps" in result ? (result.feeBps as number) : 0,
  };
}

/**
 * What an order would cost, before anybody commits to it.
 *
 * A partner showing their customer a confirm screen needs the fee on it, and
 * the only honest way to produce that number is the arithmetic that will
 * actually run — so this calls the same quote functions the execution path
 * calls rather than reproducing the percentages. A preview computed
 * independently is a preview that can disagree with the fill, and the day it
 * does, the customer is the one who finds out.
 *
 * It is indicative and says so. Prices move between a quote and a fill, and
 * on the US board a shilling order also converts at whatever rate the swap
 * reports at the moment it runs.
 */
export type OrderQuote = {
  ok: true;
  security: string;
  venue: "DSE" | "US";
  side: "buy" | "sell";
  currency: string;
  price: number;
  /** Shares the customer would receive, or is giving up. */
  qty: number;
  /** What leaves their balance on a buy; what is received on a sell. */
  amount: number;
  fee: number;
  feeCurrency: string;
  feeBps: number;
  /** The amount actually invested or realised, once the fee is off. */
  net: number;
  indicative: true;
};

export async function quoteOrderFor(
  input: OrderRequest,
): Promise<OrderQuote | { ok: false; code: string; error: string; status: number }> {
  const security = input.security.trim().toUpperCase();
  const side = input.side === "sell" ? "sell" : "buy";
  const currency = String(input.currency ?? "TZS").toUpperCase() === "USDC" ? "USDC" : "TZS";
  const amount = Number(input.amount);

  if (!security) {
    return { ok: false, code: "security_required", error: "Name the security.", status: 400 };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: "bad_amount", error: "Amount must be positive.", status: 400 };
  }

  const { dseMarket } = await import("./dseTrading");
  const market = await dseMarket(security).catch(() => null);

  if (market) {
    const { quoteBuyTzs, quoteSellQty } = await import("./dseTrading");
    const q = side === "buy" ? quoteBuyTzs(market.price, amount)
                             : quoteSellQty(market.price, amount);
    return {
      ok: true, security: market.symbol, venue: "DSE", side, currency: "TZS",
      price: q.price, qty: q.qty,
      /* On a buy this is what leaves the balance; on a sell, what arrives. */
      amount: q.tzs, fee: q.fee, feeCurrency: "TZS", feeBps: q.feeBps,
      net: side === "buy" ? q.netTzs : q.tzs,
      indicative: true,
    };
  }

  /* The US board, priced from the same feed the trade will be bounded against. */
  const { ASSETS } = await import("./assets");
  const asset = ASSETS.find(
    (a) => a.symbol.toUpperCase() === security || a.ticker.toUpperCase() === security);
  if (!asset) {
    return { ok: false, code: "unknown_security",
      error: `No security called ${security}.`, status: 404 };
  }

  const { getMarkets } = await import("./markets");
  const m = (await getMarkets({ depth: 1 }).catch(() => []))
    .find((x) => x.symbol === asset.symbol);
  if (!m?.price) {
    return { ok: false, code: "no_price",
      error: `No price is available for ${asset.symbol} right now.`, status: 503 };
  }

  const { FEE_BPS, feeEnabled } = await import("./fees");
  const bps = feeEnabled ? FEE_BPS : 0;

  /*
   * A shilling order on the US board converts first, so the dollars it ends
   * up spending depend on the swap rate at the moment it runs. Quoted at the
   * live rate and flagged indicative, because that is the honest shape — the
   * alternative is a number that looks exact and is not.
   */
  let usdcIn = amount;
  if (side === "buy" && currency === "TZS") {
    const { getSwapRate } = await import("./ntzs");
    const out = await getSwapRate("NTZS", "USDC", Math.max(1, Math.round(amount)))
      .then((r) => Number(r.expectedOutput ?? 0)).catch(() => 0);
    if (!(out > 0)) {
      return { ok: false, code: "rate_unavailable",
        error: "No shilling rate is available to price that right now.", status: 503 };
    }
    usdcIn = out;
  }

  if (side === "buy") {
    const fee = Math.round((usdcIn * bps) / 10_000 * 1e6) / 1e6;
    const net = usdcIn - fee;
    return {
      ok: true, security: asset.symbol, venue: "US", side, currency,
      price: m.price, qty: net / m.price,
      amount, fee, feeCurrency: "USDC", feeBps: bps, net,
      indicative: true,
    };
  }

  /* A sell is charged on the way out, so what arrives is already net. */
  const gross = amount * m.price;
  const fee = Math.round((gross * bps) / 10_000 * 1e6) / 1e6;
  return {
    ok: true, security: asset.symbol, venue: "US", side, currency: "USDC",
    price: m.price, qty: amount,
    amount: gross - fee, fee, feeCurrency: "USDC", feeBps: bps, net: gross - fee,
    indicative: true,
  };
}
