import { partnerRoute, send, sendFail, fail, partnerCustomer } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/**
 * Pays one of the partner's customers out — to mobile money, a bank, or a
 * wallet.
 *
 * The two exits are genuinely different and the request says which by what it
 * carries, not by a mode flag:
 *
 *   `phone`, or `bank_code` + `account_number` — shillings, through a
 *   Tanzanian rail, priced in TZS. Verified accounts only, and when the float
 *   cannot cover it the payout is accepted and queued rather than refused. A
 *   partner showing their customer "withdrawal sent" when the body says
 *   `queued` would be misreporting it; the field is there to be read.
 *
 *   `to_address` — USDC, on Base, from the customer's dollar balance. No
 *   conversion and no rail, so no queue either: it sends or it refuses.
 *
 * The dollar exit exists because every withdrawal used to end in shillings.
 * A customer who deposited USDC and wanted USDC back had to convert, pay a
 * Tanzanian rail, and arrive somewhere they could not use — two spreads to
 * end up in the wrong currency.
 */
export const POST = partnerRoute(
  "POST /v1/withdrawals",
  { movesMoney: true, idempotent: true },
  async ({ caller, body, req }) => {
    const ref = String(body.user ?? body.user_id ?? body.reference ?? "").trim();
    const toAddress = String(body.to_address ?? body.address ?? "").trim();
    const amountTzs = Math.round(Number(body.amount_tzs ?? body.amount));
    const phone = String(body.phone ?? "").replace(/[^\d]/g, "");
    const bankCode = String(body.bank_code ?? "").trim().toUpperCase();
    const accountNumber = String(body.account_number ?? "").replace(/[^\d]/g, "");

    if (!ref) return sendFail(fail("user_required", "Name the customer with `user`."));
    if (!toAddress && !phone && !(bankCode && accountNumber)) {
      return sendFail(fail("destination_required",
        "Send `to_address` for a USDC withdrawal on Base, or `phone`, or both `bank_code` "
        + "and `account_number` for a shilling payout."));
    }
    /* One destination per request. Naming two is a caller who does not know
       which currency they meant, and guessing for them moves real money. */
    if (toAddress && (phone || bankCode || accountNumber)) {
      return sendFail(fail("one_destination",
        "Send either `to_address` for USDC, or a phone/bank destination for shillings — "
        + "not both. They pay out in different currencies."));
    }

    const customer = await partnerCustomer(caller.partner.id, ref);
    if (!customer) {
      return sendFail(fail("unknown_customer", "No customer of yours matches that.", 404));
    }

    const { kycRefusal } = await import("@/lib/auth");
    const refusal = kycRefusal(customer, "withdraw");
    if (refusal) return sendFail({ ok: false, ...refusal, status: 403 });

    /*
     * The dollar exit. Deliberately before the shilling amount is validated,
     * because `amount_tzs` means nothing on this path — a USDC withdrawal is
     * denominated in USDC.
     */
    if (toAddress) {
      /*
       * Which token, decided by which amount was named.
       *
       * A wallet can hold both, so the address cannot say what to send. The
       * amount field does: `amount_usdc` is dollars, `amount_tzs` is
       * shillings paid as nTZS — which is the exit a customer wants after
       * selling a Dar es Salaam share, since nTZS is what they hold
       * everywhere else and a mobile money payout would convert it to one
       * more rail and one more fee.
       *
       * A bare `amount` is not accepted here. It would have to be guessed at,
       * and guessing between dollars and shillings is wrong by a factor of
       * two and a half thousand.
       */
      const hasUsdc = body.amount_usdc !== undefined;
      const hasTzs = body.amount_tzs !== undefined;
      if (hasUsdc === hasTzs) {
        return sendFail(fail("amount_required",
          "Send exactly one of `amount_usdc` or `amount_tzs` with `to_address`. The amount "
          + "decides which token goes to the wallet — USDC, or shillings as nTZS."));
      }

      if (hasTzs) {
        const idemTzs = (req.headers.get("idempotency-key") ?? "").trim();
        const keyTzs = idemTzs
          || `${caller.partner.id}:${customer.id}:${toAddress.toLowerCase()}:tzs:${amountTzs}:${Math.floor(Date.now() / 1000)}`;

        const { withdrawNtzsToWallet } = await import("@/lib/walletWithdrawal");
        const result = await withdrawNtzsToWallet({
          userId: customer.id, amountTzs: Number(body.amount_tzs), to: toAddress, key: keyTzs,
          via: `partner:${caller.partner.slug}`,
        });

        if (!result.ok) {
          const { status, ok, ...rest } = result; void ok;
          return send({ ok: false, ...rest }, status);
        }

        const { emit } = await import("@/lib/partners");
        void emit(caller.partner.id, "withdrawal.sent", {
          user_id: customer.id, reference: ref, asset: "NTZS",
          amount: result.amountTzs, to_address: result.to, tx_hash: result.txHash,
        }).catch(() => {});

        return send({
          ok: true, status: "sent", asset: "NTZS",
          amount_tzs: result.amountTzs, to_address: result.to,
          tx_hash: result.txHash, reference: result.reference,
          note: "Sent as nTZS on Base from the CAPX omnibus. No CAPX fee and no payout rail. "
              + "It is final once it lands — there is no recall. `tx_hash` is null when nTZS "
              + "did not return one; the transfer still went.",
        });
      }

      const amountUsdc = Number(body.amount_usdc);
      if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
        return sendFail(fail("bad_amount",
          "`amount_usdc` must be a positive number of USDC for a wallet withdrawal."));
      }

      /*
       * Keyed on the idempotency header when there is one, so a retry after a
       * timeout cannot send twice. Without one the key falls back to the
       * request's own shape, which still collapses an accidental double
       * submit of the identical withdrawal within the same second.
       */
      const idem = (req.headers.get("idempotency-key") ?? "").trim();
      const key = idem
        || `${caller.partner.id}:${customer.id}:${toAddress.toLowerCase()}:usdc:${amountUsdc}:${Math.floor(Date.now() / 1000)}`;

      const { withdrawUsdcToWallet } = await import("@/lib/walletWithdrawal");
      const result = await withdrawUsdcToWallet({
        userId: customer.id, amount: amountUsdc, to: toAddress, key,
        via: `partner:${caller.partner.slug}`,
      });

      if (!result.ok) {
        const { status, ok, ...rest } = result; void ok;
        return send({ ok: false, ...rest }, status);
      }

      const { emit } = await import("@/lib/partners");
      void emit(caller.partner.id, "withdrawal.sent", {
        user_id: customer.id, reference: ref, asset: "USDC",
        amount: result.amount, to_address: result.to, tx_hash: result.txHash,
      }).catch(() => {});

      return send({
        ok: true, status: "sent", asset: "USDC",
        amount_usdc: result.amount, to_address: result.to,
        tx_hash: result.txHash, explorer: result.explorer,
        note: "Sent onchain from the CAPX treasury. There is no CAPX fee on this; the network "
            + "fee is paid by CAPX. It is final once mined — there is no recall.",
      });
    }

    if (!Number.isFinite(amountTzs) || amountTzs <= 0) {
      return sendFail(fail("bad_amount", "`amount_tzs` must be a positive number of shillings."));
    }

    const { spendableTzs, executePayout } = await import("@/lib/payout");
    const funds = await spendableTzs(customer.id);
    if (amountTzs > funds.totalTzs) {
      return sendFail(fail("insufficient_balance",
        `That customer holds ${Math.floor(funds.totalTzs).toLocaleString()} TZS.`, 409));
    }

    const dest = bankCode ? { bankCode, accountNumber } : { phoneNumber: phone };
    const label = bankCode ? `${bankCode} account ending ${accountNumber.slice(-4)}` : phone;

    const { payoutCapacityTzs } = await import("@/lib/ntzsFunding");
    const capacity = await payoutCapacityTzs();
    if (capacity !== null && amountTzs > capacity) {
      const { db, migrate } = await import("@/lib/db");
      await migrate();
      const sql = db();
      const [queued] = await sql<{ id: string }[]>`
        insert into capx.withdrawal_queue (user_id, amount_tzs, destination)
        values (${customer.id}::uuid, ${amountTzs}, ${sql.json({ ...dest, label } as never)})
        returning id::text`;
      return send({ ok: true, status: "queued", withdrawal_id: queued.id,
        note: "Accepted and queued — the float is short of shillings right now. "
            + "It is sent automatically, oldest first, and the balance stays the customer's "
            + "until it goes out." }, 202);
    }

    try {
      const result = await executePayout({
        userId: customer.id, amountTzs, dest, label,
        key: `partner:${caller.partner.id}:${Date.now()}`,
      });
      return send({
        ok: true, status: "sent", withdrawal_id: result.ref, rail_status: result.status,
        /* Charged by the payout rail, not by CAPX, and quoted per payout —
           so it is whatever the rail reported rather than a rate we apply.
           Null when the rail did not state one. */
        fee_tzs: result.feeTzs,
        amount_tzs: amountTzs,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The payout did not go through.";
      return sendFail(fail("withdrawal_failed", msg, 502));
    }
  },
);
