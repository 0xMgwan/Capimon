import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Funding a partner's customer, and reading what has already landed.
 *
 * The rail choice — ramp, wallet collection or bank transfer, each with its
 * own minimum and its own failure handling — lives in lib/deposits.ts and is
 * called here unchanged. There is one path for money arriving, and a partner
 * uses it rather than a copy of it.
 *
 * What a partner cannot do, and will not be given, is credit a balance
 * directly. A balance that can be written without money arriving is not a
 * balance, and every solvency guarantee downstream rests on the difference.
 */
export const GET = partnerRoute("GET /v1/deposits", {}, async ({ caller, req }) => {
  const u = new URL(req.url);
  const ref = (u.searchParams.get("user") ?? "").trim();

  await migrate();
  const sql = db();

  /*
   * Settle this partner's waiting transfers before answering.
   *
   * A stablecoin transfer is safe about a minute after it is mined, and the
   * sweep that notices runs every fifteen. Reading the deposits is the moment
   * somebody actually wants to know, so the same check runs here first —
   * scoped to this partner's customers, which costs one query. Without it a
   * partner polls and is told "pending" about money that has been creditable
   * for fourteen minutes.
   */
  const { settleStablecoinDeposits } = await import("@/lib/stablecoinDeposits");
  if (ref) {
    const who = await partnerCustomer(caller.partner.id, ref);
    if (who) await settleStablecoinDeposits(who.id).catch(() => null);
  } else {
    await settleStablecoinDeposits().catch(() => null);
  }
  const rows = ref
    ? await (async () => {
        const customer = await partnerCustomer(caller.partner.id, ref);
        if (!customer) return [];
        return sql<DepositRow[]>`
          select d.id::text, d.amount_tzs::text, d.status, d.usdc_credited::text,
                 d.created_at, d.settled_at, u.partner_ref, u.id::text as user_id,
                 d.funding_tx, d.metadata->>'route' as route
            from capx.deposits d join capx.users u on u.id = d.user_id
           where d.user_id = ${customer.id}::uuid
           order by d.created_at desc limit 100`;
      })()
    : await sql<DepositRow[]>`
        select d.id::text, d.amount_tzs::text, d.status, d.usdc_credited::text,
               d.created_at, d.settled_at, u.partner_ref, u.id::text as user_id,
               d.funding_tx, d.metadata->>'route' as route
          from capx.deposits d join capx.users u on u.id = d.user_id
         where u.partner_id = ${caller.partner.id}::uuid
         order by d.created_at desc limit 100`;

  return send({ ok: true, deposits: rows.map((r) => ({
    id: r.id, user_id: r.user_id, reference: r.partner_ref,
    amount_tzs: Number(r.amount_tzs), status: r.status,
    usdc_credited: r.usdc_credited === null ? null : Number(r.usdc_credited),
    route: r.route, tx_hash: r.funding_tx,
    created_at: r.created_at, settled_at: r.settled_at,
  })) });
});

type DepositRow = {
  id: string; amount_tzs: string; status: string; usdc_credited: string | null;
  created_at: string; settled_at: string | null; partner_ref: string | null; user_id: string;
  funding_tx: string | null; route: string | null;
};

/**
 * Starts a collection from the customer's own mobile money, or returns the
 * bank details for them to push a transfer to.
 *
 * Mobile money prompts the phone and settles on its own. A bank transfer
 * returns a one-off reference and the account to pay into — nothing is taken
 * until the customer sends it, and the reference is what matches the money
 * back to them, so show it to them verbatim.
 */
export const POST = partnerRoute(
  "POST /v1/deposits",
  { movesMoney: true, idempotent: true },
  async ({ caller, body }) => {
    const ref = String(body.user ?? body.user_id ?? body.reference ?? "").trim();
    if (!ref) return sendFail(fail("user_required", "Name the customer with `user`."));

    const customer = await partnerCustomer(caller.partner.id, ref);
    if (!customer) {
      return sendFail(fail("unknown_customer", "No customer of yours matches that.", 404));
    }

    /*
     * A stablecoin transfer is a different act from a collection.
     *
     * Nothing is pulled and nothing is prompted — the partner has already
     * sent nTZS or USDC to the omnibus wallet, and this names who it belongs
     * to. The amount credited is read from the transaction's own Transfer
     * log, never from the request, so a wrong figure here credits nothing
     * wrong.
     */
    if (body.tx_hash) {
      /*
       * The trade, handed over with the transfer.
       *
       * Held rather than executed when the block is not yet safe — the money
       * is not CAPX's to trade against until then — and run the instant it
       * is, either here or on the sweep that credits it.
       */
      const oa = body.buy_on_arrival as Record<string, unknown> | undefined;
      const onArrival = oa && typeof oa === "object" && oa.security
        ? {
            security: String(oa.security),
            side: oa.side === "sell" ? "sell" as const : "buy" as const,
            amount: Number.isFinite(Number(oa.amount)) && Number(oa.amount) > 0
              ? Number(oa.amount) : undefined,
            currency: String(oa.currency ?? "").toUpperCase() === "USDC"
              ? "USDC" as const : undefined,
          }
        : undefined;

      const { creditStablecoinTransfer } = await import("@/lib/stablecoinDeposits");
      const credited = await creditStablecoinTransfer({
        userId: customer.id,
        txHash: String(body.tx_hash),
        token: String(body.token ?? "NTZS").toUpperCase() === "USDC" ? "USDC" : "NTZS",
        partnerId: caller.partner.id,
        onArrival,
      });

      if (!credited.ok) {
        const { status, ok, ...rest } = credited;
        void ok;
        return send({ ok: false, ...rest }, status);
      }

      if (!credited.duplicate && credited.state === "credited") {
        const { emit } = await import("@/lib/partners");
        void emit(caller.partner.id, "deposit.credited", {
          deposit_id: credited.depositId, user_id: customer.id, reference: ref,
          token: credited.token, amount: credited.amount, tx_hash: credited.txHash,
        }).catch(() => {});
      }

      const pending = credited.state === "pending";
      return send({
        ok: true,
        deposit: {
          id: credited.depositId, user_id: customer.id, reference: ref,
          route: "stablecoin-transfer",
          /* "pending" means recorded and not yet spendable. The hash is
             claimed either way, so there is nothing to resubmit. */
          status: pending ? "pending" : "settled",
          token: credited.token, asset: credited.asset,
          amount: credited.amount, tx_hash: credited.txHash,
          confirmations: credited.confirmations ?? null,
          /*
           * Null while the deposit waits; then "done" with the order, or
           * "failed" with the reason. A failed order never costs the deposit
           * — the money is credited and stays as the customer's cash.
           */
          buy_on_arrival: onArrival
            ? (credited.arrival ?? { status: "pending" })
            : null,
        },
        note: onArrival && credited.state === "pending"
          ? `Recorded ${credited.amount} ${credited.asset}. It is credited and the order placed `
            + `once the block is batched to Ethereum — waiting on ${credited.waitingFor}. `
            + `The fill is at the price when it executes, not now.`
          : credited.duplicate
          ? pending
            ? "Already recorded and still waiting to be safe. This is the original deposit."
            : "Already credited. This is the original deposit, not a second one."
          : pending
            ? `Recorded ${credited.amount} ${credited.asset}. It is credited once the block `
              + `containing it is batched to Ethereum — waiting on ${credited.waitingFor}. `
              + `The transaction is already claimed, so do not send it again.`
            : `Credited ${credited.amount} ${credited.asset} from the transfer.`,
      }, credited.duplicate ? 200 : pending ? 202 : 201);
    }

    const method = String(body.method ?? "mobile_money") === "bank_transfer"
      ? "bank_transfer" as const : "mobile_money" as const;

    const { startDeposit } = await import("@/lib/deposits");
    const result = await startDeposit({
      userId: customer.id,
      amountTzs: Number(body.amount_tzs ?? body.amount),
      phoneNumber: String(body.phone ?? customer.phone ?? ""),
      method,
      payerAccountNumber: body.payer_account_number
        ? String(body.payer_account_number) : undefined,
    });

    if (!result.ok) {
      const { status, ok, ...rest } = result;
      void ok;
      return send({ ok: false, ...rest }, status);
    }

    /* Stamped with who brought it, so the desk can separate a partner's
       funding from a customer's own without reconstructing it from a join. */
    const { db, migrate } = await import("@/lib/db");
    await migrate();
    await db()`update capx.deposits set partner_id = ${caller.partner.id}::uuid
                where id = ${result.depositId}::uuid`.catch(() => {});

    const { emit } = await import("@/lib/partners");
    void emit(caller.partner.id, "deposit.started", {
      deposit_id: result.depositId, user_id: customer.id, reference: ref,
      amount_tzs: Number(body.amount_tzs ?? body.amount), route: result.route,
    }).catch(() => {});

    return send({
      ok: true,
      deposit: {
        id: result.depositId,
        user_id: customer.id,
        reference: ref,
        route: result.route,
        status: result.status,
        /* Present only on the bank route: what the customer must pay into. */
        bank: result.bank ?? null,
      },
      note: result.note ?? null,
    }, 202);
  },
);
