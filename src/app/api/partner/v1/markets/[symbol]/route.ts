import { partnerRoute, send, sendFail, fail } from "@/lib/partnerApi";
import { B20_ISSUER } from "@/lib/issuer";
import { IMPACT_LIMIT_PCT } from "@/lib/depth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One security, with the evidence behind it.
 *
 * A partner reselling a tokenised share is asked by their own customer — and
 * eventually by their own regulator — what stands behind it. "CAPX says so"
 * is a poor answer when the underlying facts are on a public chain and in a
 * custodian's attestation, so they are returned here rather than summarised
 * into a reassurance.
 *
 * The two boards are backed differently and the response says which:
 *
 *   A Dar es Salaam security is a token CAPX issued against shares a licensed
 *   broker holds and attests to. The figures that matter are what the
 *   custodian confirms holding, how much of it is earmarked against tokens,
 *   and when that statement expires — evidence goes stale, and a statement
 *   from six months ago does not say the shares are there today.
 *
 *   A US equity is a Coinbase-issued B20 token CAPX buys and holds. There is
 *   no CAPX attestation because CAPX issued nothing: the backing is the
 *   treasury's own on-chain balance, readable by anybody, and the issuer's
 *   arrangements are the issuer's to evidence.
 *
 * `available` is the honest trading figure in both cases: custody minus what
 * customers are already owed, minus anything an open quote has reserved. It
 * is not supply, and a partner sizing an order should use this.
 */
export const GET = partnerRoute("GET /v1/markets/:symbol", {}, async ({ req }) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const symbol = decodeURIComponent(parts[parts.length - 1] ?? "").toUpperCase();
  if (!symbol) return sendFail(fail("symbol_required", "Name the security in the path."));

  const { dseSecurity } = await import("@/lib/dseSecurities");
  const sec = await dseSecurity(symbol).catch(() => null);

  if (sec) {
    const [{ backing }, { available }, { readOraclePrice }] = await Promise.all([
      import("@/lib/custody"), import("@/lib/otc"), import("@/lib/oracle"),
    ]);
    const [b, free, price] = await Promise.all([
      backing(sec.symbol).catch(() => null),
      available(sec.symbol).catch(() => 0),
      readOraclePrice(sec.symbol).then((q) => q?.price ?? null).catch(() => null),
    ]);

    return send({
      ok: true,
      security: {
        symbol: sec.symbol,
        name: sec.name,
        venue: "DSE",
        currency: "TZS",
        status: sec.status,
        price,
        token_address: sec.token,
        decimals: sec.decimals,
        /* "dse" is a token CAPX issued against attested custody; "external"
           is somebody else's token CAPX buys and holds, which is backed by
           the treasury's balance rather than by a CAPX attestation. */
        kind: sec.kind,
        issuer: sec.issuer,
        /* What a partner can actually sell to a customer right now. */
        available_to_trade: free,
      },
      backing: b && {
        custodian: b.custodian,
        /** Shares the custodian confirms holding. */
        underlying: b.underlying,
        /** Of those, earmarked against tokens. */
        locked: b.locked,
        /** Tokens outstanding, read from the chain where there is a token. */
        issued: b.issued,
        /** Of those, what customers are owed. */
        client_held: b.clientHeld,
        /** Issued but unsold — what is left for anyone to buy. */
        unallocated: b.unallocated,
        ratio_percent: b.ratioPct,
        headroom: b.headroom,
        /** False when the attestation has expired or none is approved. */
        fresh: b.fresh,
        /** "chain" is the published registry entry; "filed" is the desk's copy. */
        source: b.custodySource,
        /* Set when the filed copy and the published registry disagree.
           Reported rather than averaged away — the smaller figure is used. */
        mismatch: b.custodyMismatch,
        expires_at: b.expiresAt,
        last_verified: b.lastVerified,
        /** issued − recorded. Non-zero means the log and the chain differ. */
        drift: b.drift,
      },
      note: "Backing is attested by the custodian and published on-chain. `available_to_trade` "
          + "is custody less what customers are already owed, which is the figure to size an "
          + "order against — not `issued`.",
    });
  }

  /* The US board. */
  const { ASSETS } = await import("@/lib/assets");
  const asset = ASSETS.find(
    (a) => a.symbol.toUpperCase() === symbol || a.ticker.toUpperCase() === symbol);
  if (!asset) {
    return sendFail(fail("not_found",
      `No security called ${symbol}. Use the symbol from /v1/markets.`, 404));
  }

  const [{ getMarkets }, { treasuryHoldings, treasuryAddress }] = await Promise.all([
    import("@/lib/markets"), import("@/lib/treasury"),
  ]);
  const [markets, held] = await Promise.all([
    getMarkets({ depth: 1 }).catch(() => []),
    treasuryHoldings({ prices: true }).catch(() => null),
  ]);
  const m = markets.find((x) => x.symbol === asset.symbol);
  const ours = held?.holdings?.find((h) => h.asset === asset.symbol);

  /* What the market will sell, quoted live and cached briefly. Null when the
     aggregator could not be reached — unknown, not zero. */
  const { marketDepth } = await import("@/lib/depth");
  const depth = m
    ? await marketDepth(asset.token, m.decimals, m.multiplier).catch(() => null)
    : null;

  /* What customers are owed, against what the treasury actually holds. */
  const { totalLiabilities } = await import("@/lib/ledger");
  const owed = await totalLiabilities()
    .then((ls) => ls.find((l) => l.asset === asset.symbol)?.amount ?? 0).catch(() => 0);

  /*
   * Unknown is not the same answer as no.
   *
   * `treasuryHoldings` drops anything it holds none of, and used to drop
   * anything it could not *read* in exactly the same way — so one failed
   * multicall entry made a fully backed security report `covered: false` to
   * a partner while CAPX's own solvency page, comparing the same two
   * numbers, said it was covered. Telling a reseller their customers'
   * securities are unbacked because a node timed out is the worst available
   * way to be wrong.
   *
   * So a balance that could not be read is reported as null and labelled,
   * the way /v1/attestation already reports an unavailable solvency check.
   */
  const unread = held === null || (held.unreadable ?? []).includes(asset.symbol);
  const inTreasury = unread ? null : (ours?.qty ?? 0);
  return send({
    ok: true,
    security: {
      symbol: asset.symbol,
      ticker: asset.ticker,
      name: asset.name,
      venue: asset.exchange,
      currency: "USD",
      price: m?.price ?? null,
      token_address: asset.token,
      price_feed: asset.feed,
      /* B20 tokens carry a multiplier: one token is not permanently one
         share, and a dividend or split moves it. Always apply the current
         value when converting tokens to shares. */
      multiplier: m?.multiplier ?? null,
      onchain_supply: m?.supply ?? 0,
      /* Supply is issuance, not tradability. A token nobody has minted
         cannot be routed to, whatever its feed reports. */
      tradable: (m?.supply ?? 0) > 0,
      /*
       * Null, because on this board there is no such limit.
       *
       * It used to report the treasury's surplus over what customers are
       * owed, which is the right question on the Dar es Salaam board — there
       * CAPX issues tokens against attested custody and can only sell what
       * has actually been tokenised. On the US board CAPX issues nothing and
       * holds no inventory to sell from: a buy routes to Aerodrome and
       * acquires the shares at the moment it settles. usOrders.ts has no
       * inventory check anywhere in it, and never had.
       *
       * So the number was describing accumulated rounding — a tenth of a
       * share — and partners were sizing orders against it. NEDApay showed
       * "0.009536 available" for a token with 41,770 share-equivalents
       * outstanding and millions of dollars of liquidity behind it.
       *
       * The real ceiling is price impact, and it is enforced where it is
       * measured: a route more than 15% from the oracle mark is refused.
       * That is what /v1/quote answers, so a partner sizing an order is
       * pointed there rather than at a number that means nothing.
       */
      available_to_trade: depth?.availableShares ?? null,
      fill_source: "market",
      available_note: "What the market will actually sell, not what CAPX holds. On this board "
        + "CAPX holds no inventory — a buy routes to the market and acquires the shares as it "
        + "settles — so `available_to_trade` is the largest order that still fills within "
        + `${IMPACT_LIMIT_PCT}% of the small-order price, quoted live. It is not onchain supply, `
        + "which exists but belongs to other holders and is not for sale. `depth` is the whole "
        + "curve if you need to size past it; `treasury_holds` below is backing for what "
        + "customers already own, never a cap on what they may buy.",
      /* The curve, not just the point off the end of it: a partner sizing a
         large order should see what it would cost rather than be told no. */
      depth: depth && {
        reference_price: depth.referencePrice,
        impact_limit_pct: depth.impactLimitPct,
        max_order_usd: depth.maxOrderUsd,
        deeper_than_probed: depth.deeperThanProbed,
        ladder: depth.ladder.map((r) => ({
          usd: r.usd, shares: r.shares, impact_pct: r.impactPct,
        })),
      },
    },
    backing: {
      model: "issuer-held",
      issuer: "Coinbase",
      /* "covered" / "shortfall" / "unknown" — read `status`, not `covered`,
         when you need to tell a failed check from a failed backing. */
      status: inTreasury === null ? "unknown"
        : inTreasury + 1e-9 >= owed ? "covered" : "shortfall",
      note: "CAPX issues nothing here and makes no attestation: these are Coinbase-issued B20 "
          + "tokens CAPX buys and holds. The backing CAPX is answerable for is its own "
          + "treasury balance against what its customers are owed, both below and both "
          + "readable on Base.",
      treasury_address: treasuryAddress(),
      treasury_holds: inTreasury,
      client_held: owed,
      /* Null, never false, when the balance could not be read. A boolean has
         no way to say "I do not know", and false is the dangerous guess. */
      covered: inTreasury === null ? null : inTreasury + 1e-9 >= owed,
      ...(inTreasury === null
        ? { unavailable: "The treasury balance for this security could not be read just now. "
            + "This is not a shortfall — treat it as unknown rather than as a pass or a fail, "
            + "and retry." }
        : {}),
      /*
       * What the issuer's own arrangements are, so a partner answering their
       * regulator is not left to find this out themselves. Taken from the
       * ADGM prospectus rather than from marketing copy.
       */
      issuer_structure: {
        spv: `${B20_ISSUER.spv} (${B20_ISSUER.spvDetail})`,
        custodian: `${B20_ISSUER.custodian} — ${B20_ISSUER.custodianDetail}`,
        custody: B20_ISSUER.custody,
        auditor: `${B20_ISSUER.auditor}. ${B20_ISSUER.auditStatus}.`,
        reconciliation: B20_ISSUER.reconciliation,
        regulator: B20_ISSUER.regulator,
        /* The part integrators most need to know and are least likely to guess. */
        caveat: B20_ISSUER.caveat,
        prospectus: B20_ISSUER.prospectusUrl(asset.symbol),
      },
    },
  });
});
