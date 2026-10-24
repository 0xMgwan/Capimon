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
      currency: string; venue: "DSE" | "US"; fee: number | null }
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
  };
}
