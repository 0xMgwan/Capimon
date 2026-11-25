import "server-only";
import { db, migrate } from "./db";
import { dseSecurities } from "./dseSecurities";
import { DEFAULT_CHAIN } from "./explorer";

/**
 * The Dar es Salaam book, assembled for the exchange to supervise.
 *
 * CAPX lists DSE securities in tokenised form and NEDApay is the front end
 * customers actually touch. DSE supervises the market those shares belong to,
 * so it gets a window onto this side of it: who holds what, how they came to
 * hold it, who they are and how that was verified, what backs the tokens, and
 * what money moved. Read-only, in full, and recorded when it concerns a named
 * person.
 *
 * Two rules shape every query below.
 *
 * **Scope is enforced here, not in the interface.** Only securities listed on
 * the DSE appear. A customer who has never touched one is not in the register
 * at all, a US position is never summed into a total, and a dollar flow is not
 * shown as money on this book. An interface that merely omits the US board
 * would be a presentation choice; a query that cannot return it is a boundary.
 *
 * **Positions come from the ledger.** Not from a positions table, because the
 * ledger is the record and a second copy of it drifts. The same entries the
 * customer's own portfolio is drawn from produce the figures DSE reads, so
 * the exchange and the shareholder cannot be shown different holdings.
 */

/** Symbols listed on the Dar es Salaam exchange, and nothing else. */
export async function dseSymbols(): Promise<string[]> {
  const list = await dseSecurities().catch(() => []);
  return list.filter((s) => s.kind === "dse").map((s) => s.symbol.toUpperCase());
}

/**
 * Records that somebody looked at a named customer or their documents.
 *
 * Deliberately not called for aggregate pages. A row saying DSE opened a list
 * of totals tells nobody anything and would bury the rows that do matter —
 * the ones naming a person whose identity document was opened, which is the
 * question a customer has standing to ask.
 *
 * Never throws. An audit write that can fail a read would, on the day the
 * database is unwell, present the operator with a choice between serving the
 * page and keeping the record. Failures are swallowed here and the gap is
 * visible in the trail itself, which is the honest place for it.
 */
export async function recordView(input: {
  actor: string; action: string; subject?: string | null;
  detail?: Record<string, unknown>; req?: Request;
}): Promise<void> {
  try {
    await migrate();
    const ip = input.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await db()`
      insert into capx.access_log (actor, action, subject, detail, ip)
      values (${input.actor}, ${input.action}, ${input.subject ?? null},
              ${JSON.stringify(input.detail ?? {})}::jsonb, ${ip})`;
  } catch { /* see above */ }
}

export type Overview = {
  securities: {
    symbol: string; name: string; status: string;
    /* The token itself, so every figure below can be checked against it. */
    token: string | null; decimals: number; chainId: number;
    holders: number; held: number;
    custodian: string | null; locked: number | null;
    attestationExpires: string | null; fresh: boolean;
    /* What the chain says exists, and how it divides up. */
    issued: number | null; clientHeld: number | null; unallocated: number | null;
    /* locked ÷ issued as a percentage; null when coverage is unbounded. */
    ratioPct: number | null;
    /* How much more may be issued before the attestation is breached. */
    headroom: number | null;
    /* issued − what the issuance log recorded. Non-zero means they disagree. */
    drift: number | null;
    backingError: string | null;
  }[];
  holders: number;
  verified: number;
  pending: number;
  unverified: number;
  orders30d: number;
  turnover30d: number;
  cashHeldTzs: number;
  depositedTzs: number;
  withdrawnTzs: number;
};

/**
 * The headline, for the page somebody opens first.
 *
 * Every figure is per-security or a count of people, because those are the
 * two things an exchange asks about a listing: who holds it and whether what
 * is issued is covered.
 */
export async function overview(): Promise<Overview> {
  await migrate();
  const sql = db();
  const symbols = await dseSymbols();
  if (!symbols.length) {
    return { securities: [], holders: 0, verified: 0, pending: 0, unverified: 0,
             orders30d: 0, turnover30d: 0, cashHeldTzs: 0, depositedTzs: 0, withdrawnTzs: 0 };
  }

  const list = (await dseSecurities()).filter((s) => s.kind === "dse");

  /*
   * The backing arithmetic, from the same function the proof page uses.
   *
   * Reproducing it here would have given the exchange a second set of
   * numbers to reconcile against CAPX's own, which is the one thing a
   * supervisory view must never do. It reads the chain, so it is run per
   * security in parallel and a failure degrades to a stated error rather
   * than an absent row — "we could not reach the chain" and "there is
   * nothing issued" look identical as a blank and mean opposite things.
   */
  const { backing } = await import("./custody");
  const backings = new Map<string, Awaited<ReturnType<typeof backing>> | { error: string }>();
  await Promise.all(list.map(async (sec) => {
    try {
      backings.set(sec.symbol, await backing(sec.symbol));
    } catch (e) {
      backings.set(sec.symbol, { error: e instanceof Error ? e.message : "could not be read" });
    }
  }));

  const positions = await sql<{ asset: string; holders: number; held: string }[]>`
    select l.asset, count(distinct l.user_id)::int as holders, sum(l.amount)::text as held
      from capx.ledger_entries l
     where l.asset = any(${symbols})
     group by l.asset`;

  /* The attestation in force per security — the most recent approved one that
     has not expired. An expired statement backs nothing, so it is reported
     with `fresh: false` rather than quietly omitted. */
  const attestations = await sql<{ security: string; custodian: string; locked: string;
                                   expires_at: string }[]>`
    select distinct on (security) security, custodian, locked::text, expires_at
      from capx.custody_attestations
     where security = any(${symbols}) and status = 'approved'
     order by security, issued_at desc`;

  const people = await sql<{ holders: number; verified: number; pending: number;
                             unverified: number }[]>`
    with mine as (
      select distinct l.user_id from capx.ledger_entries l where l.asset = any(${symbols})
    )
    select count(*)::int as holders,
           count(*) filter (where u.kyc_status = 'approved')::int as verified,
           count(*) filter (where u.kyc_status = 'pending')::int as pending,
           count(*) filter (where u.kyc_status not in ('approved','pending'))::int as unverified
      from mine join capx.users u on u.id = mine.user_id`;

  const trades = await sql<{ orders: number; turnover: string }[]>`
    select count(*)::int as orders,
           coalesce(sum(abs(l.amount)), 0)::text as turnover
      from capx.orders o
      left join capx.ledger_entries l
        on l.ref = o.id::text || ':cash' and l.asset = 'TZS'
     where upper(o.symbol) = any(${symbols}) and o.status = 'settled'
       and o.created_at > now() - interval '30 days'`;

  /*
   * Shillings, and only shillings.
   *
   * A customer's dollar balance belongs to the US board and is not this
   * exchange's business. The cash figure here is what is held in TZS by the
   * people who hold DSE securities — the money that could buy more of them.
   */
  const cash = await sql<{ held: string; deposited: string; withdrawn: string }[]>`
    with mine as (
      select distinct l.user_id from capx.ledger_entries l where l.asset = any(${symbols})
    )
    select coalesce(sum(l.amount), 0)::text as held,
           coalesce(sum(l.amount) filter (where l.amount > 0), 0)::text as deposited,
           coalesce(-sum(l.amount) filter (where l.amount < 0), 0)::text as withdrawn
      from capx.ledger_entries l join mine on mine.user_id = l.user_id
     where l.asset = 'TZS'`;

  const posBy = new Map(positions.map((p) => [p.asset.toUpperCase(), p]));
  const attBy = new Map(attestations.map((a) => [a.security.toUpperCase(), a]));
  const now = Date.now();

  return {
    securities: list.map((s) => {
      const p = posBy.get(s.symbol);
      const a = attBy.get(s.symbol);
      const b = backings.get(s.symbol);
      const ok = b && !("error" in b) ? b : null;
      return {
        symbol: s.symbol, name: s.name, status: s.status,
        token: s.token ?? null, decimals: s.decimals, chainId: DEFAULT_CHAIN,
        holders: p?.holders ?? 0, held: Number(p?.held ?? 0),
        custodian: a?.custodian ?? ok?.custodian ?? null,
        locked: a ? Number(a.locked) : ok?.locked ?? null,
        attestationExpires: a?.expires_at ?? ok?.expiresAt ?? null,
        fresh: a ? new Date(a.expires_at).getTime() > now : ok?.fresh ?? false,
        issued: ok?.issued ?? null,
        clientHeld: ok?.clientHeld ?? null,
        unallocated: ok?.unallocated ?? null,
        ratioPct: ok?.ratioPct ?? null,
        headroom: ok?.headroom ?? null,
        drift: ok?.drift ?? null,
        backingError: b && "error" in b ? b.error : null,
      };
    }),
    holders: people[0]?.holders ?? 0,
    verified: people[0]?.verified ?? 0,
    pending: people[0]?.pending ?? 0,
    unverified: people[0]?.unverified ?? 0,
    orders30d: trades[0]?.orders ?? 0,
    turnover30d: Number(trades[0]?.turnover ?? 0),
    cashHeldTzs: Number(cash[0]?.held ?? 0),
    depositedTzs: Number(cash[0]?.deposited ?? 0),
    withdrawnTzs: Number(cash[0]?.withdrawn ?? 0),
  };
}

export type RegisterRow = {
  userId: string; name: string | null; email: string; phone: string | null;
  country: string; kycStatus: string; kycSource: string | null;
  kycAttestedBy: string | null; joined: string;
  positions: { symbol: string; qty: number }[];
  trades: number; lastTrade: string | null; cashTzs: number;
};

/**
 * The register: every person holding or having traded a DSE security.
 *
 * Contact details included, because a register of beneficial owners that does
 * not say who they are is not a register. Nobody appears here for owning
 * Apple.
 */
export async function register(): Promise<RegisterRow[]> {
  await migrate();
  const sql = db();
  const symbols = await dseSymbols();
  if (!symbols.length) return [];

  const rows = await sql<{ user_id: string; name: string | null; email: string;
                           phone: string | null; country: string; kyc_status: string;
                           kyc_source: string | null; kyc_attested_by: string | null;
                           created_at: string; trades: number; last_trade: string | null;
                           cash: string }[]>`
    with mine as (
      select distinct user_id from capx.ledger_entries where asset = any(${symbols})
    )
    select u.id::text as user_id, u.name, u.email, u.phone, u.country, u.kyc_status,
           u.kyc_source, u.kyc_attested_by, u.created_at,
           (select count(*)::int from capx.orders o
             where o.user_id = u.id and upper(o.symbol) = any(${symbols})
               and o.status = 'settled') as trades,
           (select max(o.created_at) from capx.orders o
             where o.user_id = u.id and upper(o.symbol) = any(${symbols})) as last_trade,
           (select coalesce(sum(l.amount), 0)::text from capx.ledger_entries l
             where l.user_id = u.id and l.asset = 'TZS') as cash
      from mine join capx.users u on u.id = mine.user_id
     order by u.created_at desc`;

  const held = await sql<{ user_id: string; asset: string; qty: string }[]>`
    select user_id::text, asset, sum(amount)::text as qty
      from capx.ledger_entries
     where asset = any(${symbols})
     group by user_id, asset
    having sum(amount) <> 0`;

  const byUser = new Map<string, { symbol: string; qty: number }[]>();
  for (const h of held) {
    const list = byUser.get(h.user_id) ?? [];
    list.push({ symbol: h.asset.toUpperCase(), qty: Number(h.qty) });
    byUser.set(h.user_id, list);
  }

  return rows.map((r) => ({
    userId: r.user_id, name: r.name, email: r.email, phone: r.phone, country: r.country,
    kycStatus: r.kyc_status, kycSource: r.kyc_source, kycAttestedBy: r.kyc_attested_by,
    joined: r.created_at, positions: byUser.get(r.user_id) ?? [],
    trades: r.trades, lastTrade: r.last_trade, cashTzs: Number(r.cash),
  }));
}

export type CustomerFile = {
  user: { userId: string; name: string | null; email: string; phone: string | null;
          country: string; nida: string | null; docType: string | null;
          kycStatus: string; kycSource: string | null; kycAttestedBy: string | null;
          kycAttestedAt: string | null; joined: string };
  documents: { id: string; docType: string; docNumber: string | null; status: string;
               reason: string | null; reviewedBy: string | null; reviewedAt: string | null;
               filedAt: string; docMime: string; selfieMime: string }[];
  positions: { symbol: string; qty: number; bought: number; sold: number }[];
  orders: { id: string; side: string; symbol: string; qty: number | null;
            price: number | null; amountTzs: number | null; status: string;
            createdAt: string; settledAt: string | null; txHash: string | null }[];
  ledger: { id: string; kind: string; asset: string; amount: number; ref: string | null;
            createdAt: string }[];
  deposits: { id: string; amountTzs: number; status: string; route: string | null;
              reference: string | null; fundingTx: string | null; transferTx: string | null;
              createdAt: string; settledAt: string | null }[];
  withdrawals: { id: string; amountTzs: number; status: string; destination: string;
                 createdAt: string; sentAt: string | null }[];
};

/**
 * One customer's whole file on this book.
 *
 * Everything an exchange would ask for about a shareholder: who they are, how
 * they were identified and by whom, what they hold, every order that produced
 * it, and the money that funded it. The identity document itself is a
 * separate request, because fetching image bytes nobody looked at would log a
 * view that did not happen.
 */
export async function customerFile(userId: string): Promise<CustomerFile | null> {
  await migrate();
  const sql = db();
  const symbols = await dseSymbols();

  const [u] = await sql<{ id: string; name: string | null; email: string; phone: string | null;
                          country: string; nida_number: string | null; doc_type: string | null;
                          kyc_status: string; kyc_source: string | null;
                          kyc_attested_by: string | null; kyc_attested_at: string | null;
                          created_at: string }[]>`
    select id::text, name, email, phone, country, nida_number, doc_type, kyc_status,
           kyc_source, kyc_attested_by, kyc_attested_at, created_at
      from capx.users where id = ${userId}::uuid`;
  if (!u) return null;

  /*
   * Shown only to somebody who has traded on this exchange's book.
   *
   * A CAPX customer who only ever bought Apple is not DSE's to inspect, and
   * the fact that they exist is not either. The same 404 is returned for them
   * as for an id that does not exist, so the portal cannot be used to
   * enumerate the rest of the customer base.
   */
  const [touched] = await sql<{ n: number }[]>`
    select count(*)::int as n from capx.ledger_entries
     where user_id = ${userId}::uuid and asset = any(${symbols})`;
  if (!touched || touched.n === 0) return null;

  const [documents, positions, orders, ledger, deposits, withdrawals] = await Promise.all([
    sql<{ id: string; doc_type: string; doc_number: string | null; status: string;
          reason: string | null; reviewed_by: string | null; reviewed_at: string | null;
          created_at: string; doc_mime: string; selfie_mime: string }[]>`
      select id::text, doc_type, doc_number, status, reason, reviewed_by, reviewed_at,
             created_at, doc_mime, selfie_mime
        from capx.kyc_submissions where user_id = ${userId}::uuid
       order by created_at desc`,

    sql<{ asset: string; qty: string; bought: string; sold: string }[]>`
      select asset, sum(amount)::text as qty,
             coalesce(sum(amount) filter (where amount > 0), 0)::text as bought,
             coalesce(-sum(amount) filter (where amount < 0), 0)::text as sold
        from capx.ledger_entries
       where user_id = ${userId}::uuid and asset = any(${symbols})
       group by asset order by asset`,

    sql<{ id: string; side: string; symbol: string; qty: string | null; price: string | null;
          cash: string | null; status: string; created_at: string; settled_at: string | null;
          tx_hash: string | null }[]>`
      select o.id::text, o.side, o.symbol, o.qty::text, o.price::text,
             (select abs(l.amount)::text from capx.ledger_entries l
               where l.ref = o.id::text || ':cash' and l.asset = 'TZS' limit 1) as cash,
             o.status, o.created_at, o.settled_at, o.tx_hash
        from capx.orders o
       where o.user_id = ${userId}::uuid and upper(o.symbol) = any(${symbols})
       order by o.created_at desc limit 500`,

    /* The cash side and the share side, and nothing denominated in dollars. */
    sql<{ id: string; kind: string; asset: string; amount: string; ref: string | null;
          created_at: string }[]>`
      select id::text, kind, asset, amount::text, ref, created_at
        from capx.ledger_entries
       where user_id = ${userId}::uuid and (asset = any(${symbols}) or asset = 'TZS')
       order by created_at desc limit 500`,

    /* The chain references too: a deposit that arrived as a stablecoin
       transfer has a transaction behind it, and a reference nobody can follow
       is not evidence of anything. */
    sql<{ id: string; amount_tzs: string; status: string; route: string | null;
          reference: string | null; funding_tx: string | null; transfer_tx: string | null;
          created_at: string; settled_at: string | null }[]>`
      select id::text, amount_tzs::text, status, metadata->>'route' as route,
             ntzs_reference as reference, funding_tx, transfer_tx, created_at, settled_at
        from capx.deposits where user_id = ${userId}::uuid
       order by created_at desc limit 200`,

    sql<{ id: string; amount_tzs: string; status: string; destination: string;
          created_at: string; sent_at: string | null }[]>`
      select id::text, amount_tzs::text, status, destination::text, created_at, sent_at
        from capx.withdrawal_queue where user_id = ${userId}::uuid
       order by created_at desc limit 200`,
  ]);

  return {
    user: {
      userId: u.id, name: u.name, email: u.email, phone: u.phone, country: u.country,
      nida: u.nida_number, docType: u.doc_type, kycStatus: u.kyc_status,
      kycSource: u.kyc_source, kycAttestedBy: u.kyc_attested_by,
      kycAttestedAt: u.kyc_attested_at, joined: u.created_at,
    },
    documents: documents.map((d) => ({
      id: d.id, docType: d.doc_type, docNumber: d.doc_number, status: d.status,
      reason: d.reason, reviewedBy: d.reviewed_by, reviewedAt: d.reviewed_at,
      filedAt: d.created_at, docMime: d.doc_mime, selfieMime: d.selfie_mime,
    })),
    positions: positions.map((p) => ({
      symbol: p.asset.toUpperCase(), qty: Number(p.qty),
      bought: Number(p.bought), sold: Number(p.sold),
    })),
    orders: orders.map((o) => ({
      id: o.id, side: o.side, symbol: o.symbol.toUpperCase(),
      qty: o.qty === null ? null : Number(o.qty),
      price: o.price === null ? null : Number(o.price),
      amountTzs: o.cash === null ? null : Number(o.cash),
      status: o.status, createdAt: o.created_at, settledAt: o.settled_at, txHash: o.tx_hash,
    })),
    ledger: ledger.map((l) => ({
      id: l.id, kind: l.kind, asset: l.asset.toUpperCase(), amount: Number(l.amount),
      ref: l.ref, createdAt: l.created_at,
    })),
    deposits: deposits.map((d) => ({
      id: d.id, amountTzs: Number(d.amount_tzs), status: d.status, route: d.route,
      reference: d.reference, fundingTx: d.funding_tx, transferTx: d.transfer_tx,
      createdAt: d.created_at, settledAt: d.settled_at,
    })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id, amountTzs: Number(w.amount_tzs), status: w.status,
      destination: w.destination, createdAt: w.created_at, sentAt: w.sent_at,
    })),
  };
}

/** Every settled and failed order in a DSE security, newest first. */
export async function blotter(limit = 500) {
  await migrate();
  const sql = db();
  const symbols = await dseSymbols();
  if (!symbols.length) return [];

  const rows = await sql<{ id: string; user_id: string; name: string | null; email: string;
                           kyc_status: string; side: string; symbol: string; qty: string | null;
                           price: string | null; cash: string | null; status: string;
                           error: string | null; created_at: string; settled_at: string | null;
                           tx_hash: string | null }[]>`
    select o.id::text, o.user_id::text, u.name, u.email, u.kyc_status, o.side, o.symbol,
           o.qty::text, o.price::text,
           (select abs(l.amount)::text from capx.ledger_entries l
             where l.ref = o.id::text || ':cash' and l.asset = 'TZS' limit 1) as cash,
           o.status, o.error, o.created_at, o.settled_at, o.tx_hash
      from capx.orders o join capx.users u on u.id = o.user_id
     where upper(o.symbol) = any(${symbols})
     order by o.created_at desc limit ${limit}`;

  return rows.map((o) => ({
    id: o.id, userId: o.user_id, name: o.name, email: o.email, kycStatus: o.kyc_status,
    side: o.side, symbol: o.symbol.toUpperCase(),
    qty: o.qty === null ? null : Number(o.qty),
    price: o.price === null ? null : Number(o.price),
    amountTzs: o.cash === null ? null : Number(o.cash),
    status: o.status, error: o.error,
    createdAt: o.created_at, settledAt: o.settled_at, txHash: o.tx_hash,
  }));
}

/** Attestations and issuance, per DSE security. */
export async function custodyTrail() {
  await migrate();
  const sql = db();
  const symbols = await dseSymbols();
  if (!symbols.length) return { attestations: [], issuance: [] };

  const [attestations, issuance] = await Promise.all([
    sql<{ id: string; security: string; custodian: string; quantity: string; locked: string;
          doc_ref: string | null; issued_at: string; expires_at: string; status: string;
          approved_by: string | null; approved_at: string | null; signer: string | null }[]>`
      select id::text, security, custodian, quantity::text, locked::text, doc_ref,
             issued_at, expires_at, status, approved_by, approved_at, signer
        from capx.custody_attestations
       where security = any(${symbols})
       order by issued_at desc limit 200`,

    sql<{ id: string; security: string; kind: string; quantity: string; tx_hash: string | null;
          actor: string | null; created_at: string }[]>`
      select id::text, security, kind, quantity::text, tx_hash, actor, created_at
        from capx.issuance_events
       where security = any(${symbols})
       order by created_at desc limit 200`,
  ]);

  return {
    attestations: attestations.map((a) => ({
      id: a.id, security: a.security.toUpperCase(), custodian: a.custodian,
      quantity: Number(a.quantity), locked: Number(a.locked), docRef: a.doc_ref,
      issuedAt: a.issued_at, expiresAt: a.expires_at, status: a.status,
      approvedBy: a.approved_by, approvedAt: a.approved_at, signer: a.signer,
      fresh: new Date(a.expires_at).getTime() > Date.now(),
    })),
    issuance: issuance.map((i) => ({
      id: i.id, security: i.security.toUpperCase(), kind: i.kind,
      quantity: Number(i.quantity), txHash: i.tx_hash, actor: i.actor, createdAt: i.created_at,
    })),
  };
}

/**
 * Shillings in and out, for the people on this book.
 *
 * Scoped to TZS by asset rather than by customer intent: a dollar that was
 * converted and then spent on CRDB appears here as the shillings it became,
 * at the moment it became them, which is the only point at which it was money
 * on this exchange's book.
 */
export async function moneyTrail(limit = 300) {
  await migrate();
  const sql = db();
  const symbols = await dseSymbols();
  if (!symbols.length) {
    return { deposits: [], withdrawals: [], fees: [],
             split: { totalBps: 0, brokerBps: 0, capxBps: 0 } };
  }

  const [deposits, withdrawals, fees] = await Promise.all([
    sql<{ id: string; user_id: string; name: string | null; email: string; amount_tzs: string;
          status: string; route: string | null; reference: string | null;
          funding_tx: string | null; transfer_tx: string | null; created_at: string;
          settled_at: string | null }[]>`
      with mine as (
        select distinct user_id from capx.ledger_entries where asset = any(${symbols})
      )
      select d.id::text, d.user_id::text, u.name, u.email, d.amount_tzs::text, d.status,
             d.metadata->>'route' as route, d.ntzs_reference as reference,
             d.funding_tx, d.transfer_tx, d.created_at, d.settled_at
        from capx.deposits d
        join mine on mine.user_id = d.user_id
        join capx.users u on u.id = d.user_id
       order by d.created_at desc limit ${limit}`,

    sql<{ id: string; user_id: string; name: string | null; email: string; amount_tzs: string;
          status: string; destination: string; created_at: string; sent_at: string | null }[]>`
      with mine as (
        select distinct user_id from capx.ledger_entries where asset = any(${symbols})
      )
      select w.id::text, w.user_id::text, u.name, u.email, w.amount_tzs::text, w.status,
             w.destination::text, w.created_at, w.sent_at
        from capx.withdrawal_queue w
        join mine on mine.user_id = w.user_id
        join capx.users u on u.id = w.user_id
       order by w.created_at desc limit ${limit}`,

    /*
     * What the trade cost, per security.
     *
     * Read from the cash leg's metadata rather than from a fee entry of its
     * own, because that is where it is: a DSE order writes one customer entry
     * for the shillings and carries the fee on it, and the matching house
     * legs live in the journal. Joining to a `:fee` ref would have returned
     * zero for every security and read as "no fees charged", which is the
     * worst way for this to be wrong — a supervisor would have believed it.
     */
    sql<{ security: string; trades: number; consideration: string; fee_tzs: string }[]>`
      select upper(o.symbol) as security, count(*)::int as trades,
             coalesce(sum(abs(l.amount)), 0)::text as consideration,
             coalesce(sum((l.metadata->>'fee')::numeric), 0)::text as fee_tzs
        from capx.orders o
        join capx.ledger_entries l
          on l.ref = o.id::text || ':cash' and l.asset = 'TZS'
       where upper(o.symbol) = any(${symbols}) and o.status = 'settled'
       group by upper(o.symbol) order by 1`,
  ]);

  /* The split is a rate rather than a stored figure, so it is applied here
     rather than summed: what the broker earned is what the rate says of what
     was charged, and stating the rate alongside it lets the reader check. */
  const { BROKER_FEE_BPS, CAPX_FEE_BPS, FEE_BPS, brokerShare } = await import("./fees");

  return {
    deposits: deposits.map((d) => ({
      id: d.id, userId: d.user_id, name: d.name, email: d.email,
      amountTzs: Number(d.amount_tzs), status: d.status, route: d.route,
      reference: d.reference, fundingTx: d.funding_tx, transferTx: d.transfer_tx,
      createdAt: d.created_at, settledAt: d.settled_at,
    })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id, userId: w.user_id, name: w.name, email: w.email,
      amountTzs: Number(w.amount_tzs), status: w.status, destination: w.destination,
      createdAt: w.created_at, sentAt: w.sent_at,
    })),
    fees: fees.map((f) => {
      const fee = Number(f.fee_tzs);
      const broker = brokerShare(fee);
      return {
        security: f.security, trades: f.trades,
        considerationTzs: Number(f.consideration),
        feeTzs: fee, brokerTzs: broker, capxTzs: fee - broker,
      };
    }),
    split: { totalBps: FEE_BPS, brokerBps: BROKER_FEE_BPS, capxBps: CAPX_FEE_BPS },
  };
}

/**
 * Whose document this is, if they are on this book at all.
 *
 * Asked before any identity image is served. Without it the portal would hand
 * over any submission in the table to anybody who guessed its id, and DSE's
 * scope would end at the interface rather than at the data — the US board's
 * customers included, who are nothing to do with this exchange.
 */
export async function documentOnBook(
  submissionId: string,
): Promise<{ userId: string; name: string | null; docType: string } | null> {
  await migrate();
  const sql = db();
  const symbols = await dseSymbols();
  if (!symbols.length) return null;

  const [row] = await sql<{ user_id: string; name: string | null; doc_type: string }[]>`
    select k.user_id::text, u.name, k.doc_type
      from capx.kyc_submissions k
      join capx.users u on u.id = k.user_id
     where k.id = ${submissionId}::uuid
       and exists (select 1 from capx.ledger_entries l
                    where l.user_id = k.user_id and l.asset = any(${symbols}))`;
  return row ? { userId: row.user_id, name: row.name, docType: row.doc_type } : null;
}

/**
 * The trail of the auditors: who opened what, newest first.
 *
 * `detail` arrives as text rather than as an object. The client is opened
 * with `prepare: false` for the serverless pooler, which puts it on the
 * simple query protocol, and that returns every column as text — which is
 * why the rest of this codebase reaches into jsonb with `->>` instead of
 * selecting the column whole. Parsed here rather than left to the caller,
 * because a field typed as an object that is actually a string renders as
 * `"{}"` in a table and nobody notices for a month.
 */
export async function accessTrail(limit = 300) {
  await migrate();
  const rows = await db()<{ id: string; actor: string; action: string; subject: string | null;
                            detail: unknown; ip: string | null;
                            created_at: string }[]>`
    select id::text, actor, action, subject, detail::text, ip, created_at
      from capx.access_log order by created_at desc limit ${limit}`;

  const asObject = (v: unknown): Record<string, unknown> => {
    if (v && typeof v === "object") return v as Record<string, unknown>;
    if (typeof v !== "string") return {};
    try {
      const parsed: unknown = JSON.parse(v);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  };

  return rows.map((r) => ({
    id: r.id, actor: r.actor, action: r.action, subject: r.subject,
    detail: asObject(r.detail), ip: r.ip, createdAt: r.created_at,
  }));
}
