import "server-only";

/**
 * Everyone who can take the other side of a customer's order.
 *
 * CAPX has filled every DSE trade from its own treasury since the first one.
 * That made CAPX the counterparty to its whole book: it owned the price risk
 * on unsold inventory, and when a customer's position appreciated it funded
 * the gain out of its own balance sheet. The decision to become a router —
 * matching customers against makers, with the treasury as one maker among
 * several rather than the only one — is what this file exists to serve.
 *
 * The treasury is deliberately not special here. It appears in the list like
 * FIMCO, a bank or another broker, with capacity read the same way and
 * allocated under the same rule. Special-casing it is exactly the shape the
 * router is meant to remove, and leaving it in would mean every later change
 * had to be made twice.
 *
 * ## Everyone fills at the mark
 *
 * Makers do not post their own prices yet. That is the active tier — a firm
 * running its own book and quoting against it — and it needs a real order
 * book to be meaningful. The passive tier is where the first bank
 * conversation starts: money posted into the facility, filled at the
 * published oracle price, earning the spread. So price is not an input to
 * the allocation below, and when it becomes one this is the file that grows
 * a comparison rather than the one that gets replaced.
 *
 * ## What this does not do yet
 *
 * It reads capacity and decides who should fill. It does not execute: orders
 * still settle against the treasury until the SettlementEngine is wired, at
 * which point the maker chosen here becomes the `seller` that `settle()`
 * already takes as a parameter.
 *
 * `quoteAllocation` answers the question without placing anything, so the
 * decision can be put in front of a person — on the desk, or in a test
 * against real balances — before a customer's order depends on it. Nothing
 * reads it yet; wiring it to the order path is the same change that wires
 * settlement, because the maker who fills and the party who settles have to
 * be the same one.
 */

export type MakerKind = "treasury" | "provider";

/** One maker's ability to fill, in the unit of the side being filled. */
export type MakerCapacity = {
  /** "treasury", or the liquidity provider's id. */
  id: string;
  kind: MakerKind;
  name: string;
  /** Shares they can sell, or shillings they can buy with. */
  capacity: number;
  /** Why they can do nothing, when they can do nothing. */
  reason: string | null;
};

export type Fill = { id: string; kind: MakerKind; name: string; amount: number };

export type Allocation = {
  fills: Fill[];
  /** What no maker could take. Zero when the order is fully covered. */
  unfilled: number;
};

/**
 * Who fills, and how much each.
 *
 * Largest capacity first, taking as much from each as they have, until the
 * order is covered.
 *
 * The alternative was pro rata, splitting every order across every funded
 * maker in proportion to what they posted. It distributes earnings more
 * evenly on any single trade and it was rejected for two reasons: it turns
 * one trade into one settlement per maker, which multiplies the ledger
 * entries and the on-chain settlements a single customer order produces; and
 * it is harder to show a counterparty why they received what they did.
 *
 * Largest-first self-levels instead of needing to be levelled. A maker who
 * fills drops down the order as their capacity falls, so flow moves to
 * whoever has most posted, and over a run of orders the distribution tends
 * toward the pro-rata one without splitting any single order to get there.
 * Ties break on name so the same inputs always produce the same allocation —
 * an allocation that varied between two identical reads would be impossible
 * to reconcile afterwards.
 */
export function allocate(makers: readonly MakerCapacity[], want: number): Allocation {
  const fills: Fill[] = [];
  if (!(want > 0)) return { fills, unfilled: 0 };

  const ranked = [...makers]
    .filter((m) => m.capacity > 0)
    .sort((a, b) => (b.capacity - a.capacity) || a.name.localeCompare(b.name));

  let left = want;
  for (const m of ranked) {
    if (left <= 0) break;
    const amount = Math.min(left, m.capacity);
    /* A fill smaller than this is rounding, not liquidity. Recording one
       would create a settlement with a counterparty for a quantity that
       cannot be represented in the ledger's precision. */
    if (amount <= 1e-9) continue;
    fills.push({ id: m.id, kind: m.kind, name: m.name, amount });
    left -= amount;
  }

  return { fills, unfilled: Math.max(0, left) };
}

/** Total capacity across makers, for the desk and for a pre-trade check. */
export const totalCapacity = (makers: readonly MakerCapacity[]) =>
  makers.reduce((t, m) => t + Math.max(0, m.capacity), 0);

/**
 * Everyone who could take one side of an order in one security, right now.
 *
 * `side` is the customer's: a customer buying needs makers with shares to
 * sell, and a customer selling needs makers with shillings to buy with. The
 * two are read from different places, which is why the capacity figure is a
 * single number in the unit of the side rather than a pair — the allocation
 * above has no business knowing which unit it is counting.
 */
export async function makersFor(
  symbol: string, side: "buy" | "sell",
): Promise<MakerCapacity[]> {
  const S = symbol.toUpperCase();
  const out: MakerCapacity[] = [];

  const [{ dseMarket }, { providers, capacityOf }, { balanceOf }, { omnibusBalances }] =
    await Promise.all([
      import("./dseTrading"), import("./liquidity"),
      import("./ledger"), import("./omnibus"),
    ]);

  const market = await dseMarket(S).catch(() => null);

  /*
   * The treasury, as one maker.
   *
   * Selling, it can offer what custody holds beyond what clients are already
   * owed — the same figure the order path has always checked, read from the
   * chain rather than from our own sales record.
   *
   * Buying, its limit is the float: taking a share back credits the customer
   * shillings, and the omnibus is what those shillings are eventually paid
   * from. That is a softer limit than the share one, since the claim is
   * created before the money moves, and it is used anyway — a maker that
   * reports infinite buying capacity would always sort first and no other
   * maker would ever see flow.
   */
  const omnibus = await omnibusBalances().catch(() => ({ tzs: 0, usdc: 0 }));
  const treasuryCapacity = side === "buy"
    ? market?.availableShares ?? 0
    : omnibus.tzs;
  out.push({
    id: "treasury",
    kind: "treasury",
    name: "CAPX treasury",
    capacity: Math.max(0, treasuryCapacity),
    reason: treasuryCapacity > 0 ? null
      : side === "buy" ? "no uncommitted shares in custody" : "the float is empty",
  });

  for (const p of await providers().catch(() => [])) {
    if (!p.active) {
      out.push({ id: p.id, kind: "provider", name: p.name, capacity: 0,
        reason: "paused by the provider" });
      continue;
    }
    if (side === "buy") {
      /* What they hold of this security is what they can sell back. */
      const held = await balanceOf(p.userId, S).catch(() => 0);
      out.push({ id: p.id, kind: "provider", name: p.name, capacity: Math.max(0, held),
        reason: held > 0 ? null : `holds no ${S}` });
    } else {
      /* Their own terms decide this — committed size, daily cap, the floor
         under their balance — so it is read through capacityOf rather than
         from their balance, which would ignore every limit they agreed. */
      const cap = await capacityOf(p).catch(() => null);
      out.push({ id: p.id, kind: "provider", name: p.name,
        capacity: Math.max(0, cap?.availableTzs ?? 0),
        reason: (cap?.availableTzs ?? 0) > 0 ? null : cap?.reason ?? "unavailable" });
    }
  }

  return out;
}

/** Who would fill a given order, without placing it. */
export async function quoteAllocation(
  symbol: string, side: "buy" | "sell", want: number,
): Promise<Allocation & { makers: MakerCapacity[] }> {
  const makers = await makersFor(symbol, side);
  return { ...allocate(makers, want), makers };
}
