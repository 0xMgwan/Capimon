import "server-only";
import { transferUsdc, rampBalance, NtzsError } from "./ntzs";
import { omnibusUserId, omnibusBalances, capabilities } from "./omnibus";

/**
 * Moving USDC from the nTZS side into the CAPX treasury.
 *
 * On-ramped USDC is delivered to nTZS's settlement float — an address CAPX does
 * not hold the key for — so this crossing has to go through the API. The
 * transfers endpoint is the only one that can send USDC to an arbitrary
 * address, and it requires a user id, which is why the `wallets` grant gates
 * automated funding.
 */

export async function ntzsAvailableUsdc() {
  const caps = await capabilities();
  const parts = await Promise.all([
    caps.ramp.available ? rampBalance().then((b) => Number(b.usdcBalance ?? b.balance ?? b.usdc ?? 0)).catch(() => 0) : 0,
    caps.wallets.available ? omnibusBalances().then((b) => b.usdc).catch(() => 0) : 0,
  ]);
  return parts.reduce((a, b) => a + b, 0);
}

/**
 * Pre-funds the ramp settlement float so an off-ramp can be paid.
 *
 * The float is the one nTZS balance the treasury can reach: it is an ordinary
 * Base address, so the treasury EOA signs USDC to it directly — the direction a
 * private key can do unaided. (The reverse is impossible; no API sources a
 * transfer from the float.) Prices the payout in USDC, tops the float up if it
 * is short, and waits for the money to be visible before the caller pays out,
 * so a payout is never requested against a balance that has not arrived.
 */
export async function fundRampFloat(amountTzs: number, phoneNumber: string) {
  const { rampQuote, getSwapRate } = await import("./ntzs");
  const b = await rampBalance();
  const settlement = b.settlementAddress as `0x${string}` | undefined;
  if (!settlement) {
    throw new NtzsError("no_settlement_address", "The ramp float has no settlement address to fund.", 503);
  }

  const floatUsdc = () =>
    rampBalance().then((r) => Number(r.usdcBalance ?? r.balance ?? r.usdc ?? 0)).catch(() => 0);

  // Price from a real off-ramp quote: it reports the exact USDC the float will
  // be debited, fee included. A mid-market rate understates that by the whole
  // payout fee — several percent — which would leave the float short and the
  // payout rejected. Quoting is free and creates no obligation.
  let needUsdc = 0;
  try {
    const q = await rampQuote({ direction: "offramp", amount: amountTzs, phoneNumber });
    needUsdc = Number(q.usdcAmount ?? 0);
  } catch { /* fall back below */ }

  if (!(needUsdc > 0)) {
    const rate = await getSwapRate("NTZS", "USDC", Math.max(1000, Math.round(amountTzs)));
    const implied = Number(rate.expectedOutput ?? 0);
    if (!(implied > 0)) {
      throw new NtzsError("rate_unavailable", "No rate is available to price this withdrawal.", 503);
    }
    // Cover the payout fee the mid rate does not include.
    needUsdc = implied * 1.10;
  }
  // A little headroom, so rounding cannot leave it a cent short.
  needUsdc *= 1.02;

  let have = await floatUsdc();
  if (have >= needUsdc) return { topUp: 0, floatUsdc: have, settlement };

  const { sendUsdcToNtzs } = await import("./treasury");
  const topUp = needUsdc - have;
  // The treasury signs the top-up, so it has to hold the USDC first — and on a
  // shilling account the money is TZS in the omnibus until something converts
  // it. Without this a customer could be fully funded and still unable to
  // withdraw, because their balance was in the one form the float cannot take.
  await ensureTreasuryUsdc(topUp);
  await sendUsdcToNtzs(topUp, settlement);

  for (let i = 0; i < 12 && have < needUsdc; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    have = await floatUsdc();
  }
  if (have < needUsdc) {
    throw new NtzsError(
      "funding_incomplete",
      `Sent ${topUp.toFixed(2)} USDC to the settlement float but it still shows ${have.toFixed(2)} ` +
      `against ${needUsdc.toFixed(2)} needed. Nothing was paid out.`,
      409,
    );
  }
  return { topUp, floatUsdc: have, settlement };
}

/**
 * USDC that can actually be moved to the treasury.
 *
 * Deliberately excludes the ramp settlement float. The float backs client
 * balances and counts toward solvency, but transfers are sourced by
 * `fromUserId` only — there is no address-sourced transfer — so float USDC
 * cannot be sent to the treasury by API. Treating it as sweepable made a buy
 * attempt an impossible move and fail confusingly.
 */
export async function sweepableUsdc() {
  const caps = await capabilities();
  if (!caps.wallets.available) return 0;
  return omnibusBalances().then((b) => b.usdc).catch(() => 0);
}

export async function sweepToTreasury(usdc: number, toAddress: `0x${string}`) {
  const caps = await capabilities();

  // Only a provisioned user wallet can source a transfer.
  if (caps.wallets.available) {
    return transferUsdc({ fromUserId: await omnibusUserId(), toAddress, amount: usdc });
  }

  const float = await rampBalance()
    .then((b) => Number(b.usdcBalance ?? b.balance ?? b.usdc ?? 0))
    .catch(() => 0);

  throw new NtzsError(
    "sweep_unavailable",
    `USDC cannot be moved to the treasury automatically. ${float.toFixed(2)} USDC is sitting in the ` +
    `ramp settlement float, which the transfers API cannot source from — transfers require a ` +
    `provisioned user wallet (fromUserId). Give the CAPX omnibus user a wallet, or fund the ` +
    `treasury at ${toAddress} directly.`,
    503,
  );
}

/**
 * Puts shillings within reach of a payout.
 *
 * A withdrawal is paid out of the nTZS account, but the money backing it may be
 * sitting as USDC in the treasury. This walks it back: the treasury signs USDC
 * over to the omnibus wallet, that USDC is swapped to shillings, and the payout
 * runs from there. Each step is confirmed before the next, so a withdrawal is
 * never requested against a balance that has not arrived.
 */
export async function ensureNtzsHasTzs(amountTzs: number) {
  const caps = await capabilities();
  if (!caps.wallets.available) {
    throw new NtzsError("wallets_required",
      "Moving funds back to nTZS needs the 'wallets' capability.", 503);
  }

  const before = await omnibusBalances();
  if (before.tzs >= amountTzs) return { moved: 0, swapped: 0, tzs: before.tzs };

  const missingTzs = amountTzs - before.tzs;
  const { getSwapRate, swap } = await import("./ntzs");

  // Price the shortfall, then send a little over so the swap's own spread does
  // not leave the payout a few shillings short.
  const rate = await getSwapRate("NTZS", "USDC", Math.max(1000, Math.round(missingTzs)));
  const impliedUsdc = Number(rate.expectedOutput ?? 0);
  if (!(impliedUsdc > 0)) throw new NtzsError("rate_unavailable", "No rate is available to price this withdrawal.", 503);
  const needUsdc = impliedUsdc * 1.02;

  if (before.usdc < needUsdc) {
    const { sendUsdcToNtzs } = await import("./treasury");
    if (!before.walletAddress) {
      throw new NtzsError("no_ntzs_address", "The nTZS wallet has no address to send USDC to.", 503);
    }
    await sendUsdcToNtzs(needUsdc - before.usdc, before.walletAddress as `0x${string}`);

    // Wait for nTZS to see it before asking it to swap.
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const now = await omnibusBalances();
      if (now.usdc >= needUsdc) break;
    }
  }

  const mid = await omnibusBalances();
  const swapUsdc = Math.min(mid.usdc, needUsdc);
  if (!(swapUsdc > 0)) throw new NtzsError("funding_incomplete", "USDC has not arrived at nTZS yet.", 409);

  await swap({ userId: await omnibusUserId(), from: "USDC", to: "NTZS", amount: swapUsdc });

  const after = await omnibusBalances();
  if (after.tzs < amountTzs) {
    throw new NtzsError("funding_incomplete",
      `Converted to shillings but nTZS shows ${Math.floor(after.tzs).toLocaleString()} TZS against ` +
      `${amountTzs.toLocaleString()} needed. Nothing was paid out.`, 409);
  }
  return { moved: needUsdc, swapped: swapUsdc, tzs: after.tzs };
}

/**
 * Swaps a shilling balance into USDC, for a buy.
 *
 * A shilling account holds TZS until the moment it invests; this is that
 * moment. The omnibus swaps the shillings to USDC and leaves it in the nTZS
 * float, where the treasury's own pre-trade top-up sweeps it on-chain and waits
 * for it to land. So the rate the user gets is the rate at the instant they
 * buy, and the on-chain arrival is confirmed by the same tested path a USDC
 * buy uses. Returns the USDC actually delivered, which is what the buy is sized
 * to.
 */
export async function swapTzsToUsdc(amountTzs: number) {
  const caps = await capabilities();
  if (!caps.wallets.available) {
    throw new NtzsError("wallets_required",
      "Spending a shilling balance needs the 'wallets' capability to swap USDC.", 503);
  }
  const { swap, getSwapRate } = await import("./ntzs");
  const userId = await omnibusUserId();

  const before = await omnibusBalances();
  if (before.tzs < amountTzs) {
    throw new NtzsError("insufficient_omnibus_tzs",
      `The omnibus holds ${Math.floor(before.tzs).toLocaleString()} TZS against ` +
      `${amountTzs.toLocaleString()} to convert.`, 409);
  }

  /*
   * Price the conversion before making it, so there is an independent ceiling
   * on what this swap can be worth.
   */
  const quote = await getSwapRate("NTZS", "USDC", Math.max(1, Math.round(amountTzs)));
  const quoted = Number(quote.expectedOutput ?? 0);

  const result = await swap({ userId, from: "NTZS", to: "USDC", amount: amountTzs });

  /*
   * From here the shillings are gone.
   *
   * Every refusal below this line is a refusal about money that has already
   * moved, so each one carries what it moved. Without that the caller sees
   * only a failed order and has nothing to unwind from — which is how a
   * conversion becomes a shortfall nobody can trace.
   */
  const moved = { tzsSpent: amountTzs };

  /*
   * Take what the swap says it produced, never a balance delta.
   *
   * The omnibus is one shared account: a sweep, another customer's order or a
   * withdrawal's funding leg all move that balance too, and differencing it
   * before and after attributes every one of them to this swap. It read 0.514
   * USDC for a 200 TZS conversion worth 0.076, and the buy that followed spent
   * — and credited the customer — seven times what they had paid.
   *
   * This is the same mistake as reading a trade's fill from balanceOf instead
   * of its own receipt, in a place where the balance is not even ours alone.
   */
  const reported = Number(
    (result as Record<string, unknown>).toAmount
    ?? (result as Record<string, unknown>).outputAmount
    ?? (result as Record<string, unknown>).amountOut
    ?? (result as Record<string, unknown>).usdcAmount
    ?? 0,
  );

  const usdc = reported > 0 ? reported : quoted;
  if (!(usdc > 0)) {
    throw Object.assign(
      new NtzsError("swap_incomplete",
        "The swap reported no USDC output, and no rate was available to price it.", 409),
      { swapped: moved },
    );
  }

  /*
   * Refuse anything above what the shillings were just quoted at. A field we
   * misread, or an unexpected unit, must not become a purchase the customer did
   * not fund — buying too little is a bad trade, buying too much is a hole in
   * the book that everyone else pays for.
   */
  if (quoted > 0 && usdc > quoted * 1.05) {
    throw Object.assign(
      new NtzsError(
        "swap_output_implausible",
        `The swap reported ${usdc.toFixed(6)} USDC for ${amountTzs.toLocaleString()} TZS, but that is ` +
        `only worth about ${quoted.toFixed(6)}. Not trading on a figure that does not add up.`,
        409,
      ),
      { swapped: { ...moved, usdc: quoted } },
    );
  }

  /*
   * No balance check here, and that is the fix rather than an omission.
   *
   * This used to read the omnibus back and refuse if it held less USDC than
   * the swap had just produced. The omnibus is one shared account — the
   * comment forty lines above says exactly that, as the reason never to
   * derive this swap's output from a balance delta — and the same fact
   * invalidates a balance reading as proof. Every buy sweeps the omnibus to
   * the treasury on its way to trading, so a second order running behind the
   * first read a balance the first had already taken, and threw.
   *
   * It threw *after* the swap. The shillings had left, the customer had not
   * been debited, and the money sat as USDC on its way to the treasury with
   * the ledger still claiming shillings nobody held. A verification step that
   * invents the exact failure it exists to prevent is worse than no
   * verification.
   *
   * What actually protects this is upstream and downstream. Upstream: the
   * output is the swap's own report, bounded by a quote taken beforehand, so
   * a misread field cannot become a purchase nobody funded. Downstream:
   * ensureTreasuryFunded confirms on-chain that the USDC reached the treasury
   * — with retries — before a single share is bought. The money is checked
   * where it is going, not in a room everybody walks through.
   */
  return { usdc, tzsSpent: amountTzs };
}

/**
 * Puts USDC in the treasury, converting omnibus shillings if that is where the
 * money is.
 *
 * The buy path already walks TZS to the treasury; a payout needs the same walk,
 * because the settlement float only accepts USDC and only the treasury can send
 * it. Each step is skipped when it is not needed, so a treasury that already
 * holds enough costs nothing.
 */
export async function ensureTreasuryUsdc(need: number) {
  const { treasuryHoldings, treasuryAddress, ensureTreasuryFunded } = await import("./treasury");
  const to = treasuryAddress();
  if (!to) throw new NtzsError("no_treasury", "No treasury is configured.", 503);

  const holdings = await treasuryHoldings();
  const onHand = holdings?.usdc ?? 0;
  if (onHand >= need) return { converted: 0, swept: 0 };

  const short = need - onHand;
  const before = await omnibusBalances();

  // Convert only the shortfall the omnibus USDC cannot already cover.
  let converted = 0;
  if (before.usdc < short && before.tzs > 0) {
    const { getSwapRate } = await import("./ntzs");
    const probe = 100_000;
    const r = await getSwapRate("NTZS", "USDC", probe);
    const usdcPerTzs = Number(r.expectedOutput ?? 0) / probe;
    if (usdcPerTzs > 0) {
      // A little over, so the swap's own spread cannot leave the payout short.
      const wantTzs = Math.ceil(((short - before.usdc) / usdcPerTzs) * 1.02);
      const tzsToSwap = Math.min(Math.floor(before.tzs), wantTzs);
      if (tzsToSwap > 0) {
        await swapTzsToUsdc(tzsToSwap);
        converted = tzsToSwap;
      }
    }
  }

  // Sweep whatever is now in the omnibus across to the treasury.
  const { swept } = await ensureTreasuryFunded(need, to);
  return { converted, swept };
}

/**
 * Swaps a USDC balance back into shillings.
 *
 * The mirror of `swapTzsToUsdc`, and it exists because of what happens when
 * that one half-succeeds. A shilling buy converts first and trades second; if
 * the trade fails, the customer's money is correctly recorded as USDC — and
 * then there was no way back. They could buy a US share with it or withdraw
 * it, but not return it to the currency they started in, which for somebody
 * whose whole balance is shillings is a one-way door they never chose to walk
 * through.
 *
 * Every safeguard from the other direction applies here for the same reasons.
 * The conversion is priced before it is made, so there is an independent
 * ceiling. The output is taken from what the swap reports rather than from a
 * balance delta, because the omnibus is one shared account and differencing
 * it attributes every other customer's movement to this one. And a reported
 * figure above the quote is refused rather than credited: crediting too much
 * is a hole in the book that everyone else pays for.
 */
export async function swapUsdcToTzs(amountUsdc: number) {
  const caps = await capabilities();
  if (!caps.wallets.available) {
    throw new NtzsError("wallets_required",
      "Converting a dollar balance needs the 'wallets' capability.", 503);
  }
  const { swap, getSwapRate } = await import("./ntzs");
  const userId = await omnibusUserId();

  const before = await omnibusBalances();
  if (before.usdc + 1e-9 < amountUsdc) {
    throw new NtzsError("insufficient_omnibus_usdc",
      `The omnibus holds ${before.usdc.toFixed(2)} USDC against ${amountUsdc.toFixed(2)} to convert.`,
      409);
  }

  const quote = await getSwapRate("USDC", "NTZS", amountUsdc);
  const quoted = Number(quote.expectedOutput ?? 0);

  const result = await swap({ userId, from: "USDC", to: "NTZS", amount: amountUsdc });

  const reported = Number(
    (result as Record<string, unknown>).toAmount
    ?? (result as Record<string, unknown>).outputAmount
    ?? (result as Record<string, unknown>).amountOut
    ?? (result as Record<string, unknown>).ntzsAmount
    ?? 0,
  );

  const tzs = reported > 0 ? reported : quoted;
  if (!(tzs > 0)) {
    throw new NtzsError("swap_incomplete",
      "The swap reported no shilling output, and no rate was available to price it.", 409);
  }
  if (quoted > 0 && tzs > quoted * 1.05) {
    throw new NtzsError("swap_output_implausible",
      `The swap reported ${Math.round(tzs).toLocaleString()} TZS for ${amountUsdc.toFixed(2)} USDC, ` +
      `but that is only worth about ${Math.round(quoted).toLocaleString()}. ` +
      `Not crediting a figure that does not add up.`, 409);
  }

  return { usdcSpent: amountUsdc, tzs };
}

/**
 * The most CAPX could actually pay out in shillings right now.
 *
 * Distinct from what a customer is owed, and the distinction is the whole
 * point. Their balance is a claim on CAPX; this is what CAPX can presently
 * honour. The two are usually the same and diverge exactly when it matters —
 * when enough gain has been realised that the ledger owes more shillings than
 * anybody paid in, which is money that exists as shares in custody rather
 * than as cash.
 *
 * Counts only what can be moved. The omnibus shillings, plus the omnibus
 * dollars at the live rate because those can be swapped back, plus the ramp
 * float where the ramp is the rail — that float can pay somebody out even
 * though it cannot be transferred anywhere else, which is the one thing it is
 * good for.
 *
 * Fails open. If none of these can be read, the caller gets `null` and should
 * carry on: refusing a legitimate withdrawal because an RPC was slow would be
 * a worse failure than the one this exists to prevent.
 */
export async function payoutCapacityTzs(): Promise<number | null> {
  try {
    const [omnibus, rate] = await Promise.all([
      omnibusBalances(),
      import("./ntzs").then(async (m) => {
        const r = await m.getSwapRate("NTZS", "USDC", 100_000);
        const out = Number(r.expectedOutput ?? 0);
        return out > 0 ? out / 100_000 : 0;
      }).catch(() => 0),
    ]);

    let capacity = omnibus.tzs;
    if (rate > 0 && omnibus.usdc > 0) capacity += omnibus.usdc / rate;

    /*
     * The settlement float, counted only here.
     *
     * It backs balances and cannot be transferred out — which makes it
     * useless for funding a trade and perfectly good for funding a payout,
     * since a payout is the one direction it moves in.
     */
    const ramp = await import("./ntzs")
      .then((m) => m.rampBalance())
      .then((b) => Number(b.usdcBalance ?? b.balance ?? b.usdc ?? 0))
      .catch(() => 0);
    if (rate > 0 && ramp > 0) capacity += ramp / rate;

    /*
     * The treasury's dollars, which the payout path already spends.
     *
     * Leaving these out was simply wrong. `ensureNtzsHasTzs` funds a
     * disbursement by sending treasury USDC to the omnibus and swapping it,
     * so a payout can reach this money — and a capacity figure that cannot
     * see what the payout path spends will refuse, or now queue, withdrawals
     * that would have gone through.
     *
     * It matters most for US shares. Those settle in dollars: selling one is
     * a real on-chain swap, so the proceeds and the gain arrive as treasury
     * USDC rather than as shillings in the omnibus. Without this line a
     * customer who sold Apple at a profit could be queued against a float
     * that was holding their money the whole time.
     *
     * Discounted by the same 2% the funding path adds for the swap's own
     * spread, so the figure is what can actually be delivered rather than
     * what is nominally held.
     */
    const treasuryUsdc = await import("./treasury")
      .then((m) => m.treasuryHoldings())
      .then((h) => Number(h?.usdc ?? 0))
      .catch(() => 0);
    if (rate > 0 && treasuryUsdc > 0) capacity += (treasuryUsdc / 1.02) / rate;

    return capacity;
  } catch {
    return null;
  }
}
