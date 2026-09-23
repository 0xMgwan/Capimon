import { NextResponse } from "next/server";
import { db, migrate, dbConfigured } from "@/lib/db";
import { backing, canIssue, recordIssuance, reconcileIssuance, recordBurnFromChain } from "@/lib/custody";
import { roleOf, ACTOR, type OpsRole } from "@/lib/adminAuth";
import { SECURITIES_CONTRACTS } from "@/lib/assets";
import { treasuryAddress } from "@/lib/treasury";

export const dynamic = "force-dynamic";

/** What FIMCO may do. Everything else on this route is CAPX's. */
const FIMCO_ACTIONS = new Set(["attest", "request-issuance", "register-security"]);

/** About 4 MB once base64 has added its third. A scanned statement fits. */
const MAX_DOC_BYTES = 5_600_000;

/** Attestations and issuance history for the custody desk. */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  const role = roleOf(req);
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  try {
    await migrate();
    const sql = db();
    const [securities, attestations, issuance, requests] = await Promise.all([
      sql`select symbol, name, token_address, decimals, chain_id, status,
                 (metadata ? 'logo') as has_logo,
                 coalesce(metadata->>'kind', 'dse') as kind,
                 metadata->>'issuer' as issuer, metadata->>'venue' as venue,
                 coalesce((metadata->>'buyOnly')::boolean, false) as "buyOnly"
            from capx.securities order by symbol`,
      sql`select id::text, security, custodian, quantity::float8 as quantity, locked::float8 as locked,
                 doc_ref, issued_at, expires_at, status, approved_by, approved_at, filed_by,
                 -- The attachment itself is served on its own route; here it is
                 -- only whether there is one and what it is called.
                 (document is not null) as "hasDocument", document_name as "documentName",
                 (expires_at <= now()) as expired
            from capx.custody_attestations order by created_at desc limit 50`,
      sql`select id::text, security, kind, quantity::float8 as quantity, tx_hash, actor, created_at
            from capx.issuance_events order by created_at desc limit 50`,
      sql`select id::text, security, kind, quantity::float8 as quantity, note, requested_by, status,
                 decided_by, decided_at, tx_hash, executed_at, created_at
            from capx.issuance_requests order by created_at desc limit 50`,
    ]);

    const withBacking = await Promise.all(
      (securities as unknown as { symbol: string }[]).map(async (s) => ({ ...s, backing: await backing(s.symbol) })),
    );

    return NextResponse.json(
      {
        ok: true, role, securities: withBacking, attestations, issuance, requests,
        // What the desk needs to write out the exact on-chain commands.
        contracts: { custodyRegistry: SECURITIES_CONTRACTS.custodyRegistry, treasury: treasuryAddress() },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "custody query failed" },
      { status: 500 },
    );
  }
}

/**
 * Custody desk actions.
 *
 * Filing an attestation and approving it are separate steps even with one
 * operator: the approval is the moment CAPX asserts the shares are really
 * there, and it should be its own decision rather than a side effect of
 * typing numbers into a form.
 */
export async function POST(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  const role = roleOf(req);
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    if (role === "fimco" && !FIMCO_ACTIONS.has(action)) {
      return NextResponse.json({ ok: false, code: "forbidden", error: "That action is CAPX's to take." }, { status: 403 });
    }
    await migrate();
    const sql = db();

    if (action === "register-security") {
      const symbol = String(body.symbol ?? "").trim().toUpperCase();
      const name = String(body.name ?? "").trim();
      if (!symbol || !name) return NextResponse.json({ ok: false, error: "symbol and name are required" }, { status: 400 });

      const tokenAddress = body.tokenAddress ? String(body.tokenAddress).trim().toLowerCase() : null;
      let decimals = Number(body.decimals ?? 8);

      /*
       * A registered address is checked against the token it names.
       *
       * Supply is now read from this address, so a typo here would not be a
       * cosmetic error — it would silently report some other token's supply as
       * this security's, and the backing check would be measuring the wrong
       * thing entirely. The token already knows its own decimals, so they are
       * taken from it rather than from whatever was typed into the form.
       */
      if (tokenAddress) {
        if (!/^0x[0-9a-f]{40}$/.test(tokenAddress)) {
          return NextResponse.json({ ok: false, error: "That is not a valid token address." }, { status: 400 });
        }
        try {
          const { publicClient } = await import("@/lib/chain");
          const { b20Abi } = await import("@/lib/abis");
          const [onchainDecimals, onchainSymbol] = await Promise.all([
            publicClient.readContract({ address: tokenAddress as `0x${string}`, abi: b20Abi, functionName: "decimals" }),
            publicClient.readContract({ address: tokenAddress as `0x${string}`, abi: b20Abi, functionName: "symbol" }),
          ]);
          decimals = Number(onchainDecimals);
          if (body.expectSymbol && String(body.expectSymbol) !== String(onchainSymbol)) {
            return NextResponse.json(
              { ok: false, error: `That address is ${onchainSymbol}, not ${body.expectSymbol}.` },
              { status: 400 },
            );
          }
        } catch {
          return NextResponse.json(
            { ok: false, error: "That address did not answer as a token on Base — check the network and the address." },
            { status: 400 },
          );
        }
      }

      /*
       * The logo arrives already resized in the browser, as a small data URL.
       * Checked here anyway: only raster images, and small enough that a
       * listing of every security stays a light response.
       */
      /*
       * What kind of listing this is.
       *
       * "external" is a token CAPX buys and holds rather than mints — a
       * tokenised IPO, or another issuer's equity. It has no attestation and
       * no mint; its backing is the treasury's balance. `buyOnly` closes the
       * sell side while a venue does not allow selling back.
       */
      /*
       * Only what the caller actually sent.
       *
       * Writing defaults for every field turned a partial save into a reset:
       * the status buttons post just the symbol, name, address and status, so
       * pressing "Live" was silently re-declaring an external listing as one
       * CAPX mints — losing its issuer, its buy-only rule, and bringing back
       * the attestation and mint flow that do not apply to it.
       */
      const kind = body.kind === undefined
        ? undefined
        : body.kind === "external" ? "external" : "dse";
      const listing = {
        ...(kind ? { kind } : {}),
        ...(body.issuer !== undefined ? { issuer: String(body.issuer).slice(0, 120) } : {}),
        ...(body.venue !== undefined ? { venue: String(body.venue).slice(0, 200) } : {}),
        ...(body.buyOnly !== undefined ? { buyOnly: body.buyOnly === true } : {}),
      };

      let logo: string | null = null;
      if (body.logo) {
        logo = String(body.logo);
        if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 200_000) {
          return NextResponse.json({ ok: false, error: "The logo must be a PNG, JPEG or WebP under about 150 KB." }, { status: 400 });
        }
      }

      /*
       * FIMCO can put a security on the desk but not in front of customers:
       * what it registers is a draft, an existing security keeps its status,
       * and a token address already set is not replaced. Going live and
       * choosing the token are CAPX's calls.
       */
      if (role === "fimco") {
        await sql`
          insert into capx.securities (symbol, name, token_address, decimals, chain_id, status, metadata)
          values (${symbol}, ${name}, ${tokenAddress}, ${decimals}, 8453, 'draft',
                  ${sql.json({ ...listing, ...(logo ? { logo } : {}), registeredBy: ACTOR[role] })})
          on conflict (symbol) do update
            set name = excluded.name,
                token_address = coalesce(capx.securities.token_address, excluded.token_address),
                metadata = capx.securities.metadata || excluded.metadata`;
        return NextResponse.json({ ok: true });
      }

      await sql`
        insert into capx.securities (symbol, name, token_address, decimals, chain_id, status, metadata)
        values (${symbol}, ${name}, ${tokenAddress}, ${decimals},
                ${Number(body.chainId ?? 8453)}, ${String(body.status ?? "draft")},
                ${sql.json({ ...listing, ...(logo ? { logo } : {}) })})
        on conflict (symbol) do update
          set name = excluded.name,
              token_address = coalesce(excluded.token_address, capx.securities.token_address),
              decimals = excluded.decimals,
              chain_id = excluded.chain_id,
              status = excluded.status,
              -- A save without a new logo keeps the old one.
              metadata = capx.securities.metadata || excluded.metadata`;
      // A security CAPX has just registered or taken live should have a price
      // by the time anyone opens its page, not after the morning's cron.
      const { refreshIfStale } = await import("@/lib/oracle");
      refreshIfStale(symbol);
      return NextResponse.json({ ok: true });
    }

    if (action === "attest") {
      const security = String(body.security ?? "").trim().toUpperCase();
      const quantity = Number(body.quantity);
      const locked = Number(body.locked ?? body.quantity);
      const expiresAt = String(body.expiresAt ?? "");
      if (!security || !(quantity > 0)) {
        return NextResponse.json({ ok: false, error: "security and a positive quantity are required" }, { status: 400 });
      }
      // The same ceiling the contract enforces: you cannot earmark shares you
      // have not said you hold.
      if (locked > quantity) {
        return NextResponse.json({ ok: false, error: "Locked cannot exceed the quantity held." }, { status: 400 });
      }
      if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
        return NextResponse.json({ ok: false, error: "An attestation needs an expiry in the future." }, { status: 400 });
      }
      // Naming a party is only meaningful with the document they issued: an
      // attestation without a reference is a claim nobody can check.
      // FIMCO files as FIMCO; it cannot name another party as the custodian.
      const custodian = role === "fimco" ? "FIMCO" : String(body.custodian ?? "").trim();
      const docRef = String(body.docRef ?? "").trim();
      if (!custodian || !docRef) {
        return NextResponse.json({ ok: false, error: "An attestation needs the attesting party and their statement reference." }, { status: 400 });
      }
      /*
       * The document itself, when the filer attaches one.
       *
       * A reference number says a statement exists somewhere; the pledge of
       * shares or the holding statement is the thing a reviewer actually has
       * to read before asserting the shares are in the vault. Kept as a data
       * URL on the row, the way KYC documents already are — adding object
       * storage for a handful of PDFs a month would be a dependency for one
       * field.
       */
      const document = String(body.document ?? "").trim() || null;
      const documentName = String(body.documentName ?? "").trim().slice(0, 120) || null;
      if (document) {
        if (!/^data:(application\/pdf|image\/(png|jpe?g|webp|heic));base64,/i.test(document)) {
          return NextResponse.json(
            { ok: false, error: "Attach a PDF or an image." }, { status: 400 });
        }
        // Refused rather than truncated into a file nobody can open. The cap
        // is here as well as in the form because a form limit is a courtesy.
        if (document.length > MAX_DOC_BYTES) {
          return NextResponse.json(
            { ok: false, error: "That file is too large. Keep it under 4 MB." }, { status: 413 });
        }
      }

      const rows = await sql<{ id: string }[]>`
        insert into capx.custody_attestations (security, custodian, quantity, locked, doc_ref, expires_at, status, filed_by,
                                               document, document_name)
        values (${security}, ${custodian}, ${quantity}, ${locked},
                ${docRef}, ${expiresAt}, 'pending', ${ACTOR[role]},
                ${document}, ${documentName})
        returning id::text`;
      return NextResponse.json({ ok: true, id: rows[0].id });
    }

    if (action === "approve-attestation") {
      const id = String(body.id ?? "");
      if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      await sql`update capx.custody_attestations
                   set status = 'approved', approved_by = ${ACTOR[role]}, approved_at = now()
                 where id = ${id}::uuid and status = 'pending'`;
      return NextResponse.json({ ok: true });
    }

    if (action === "reject-attestation") {
      const id = String(body.id ?? "");
      await sql`update capx.custody_attestations set status = 'rejected' where id = ${id}::uuid`;
      return NextResponse.json({ ok: true });
    }

    if (action === "mint" || action === "burn") {
      const security = String(body.security ?? "").trim().toUpperCase();
      const quantity = Number(body.quantity);
      try {
        const id = await recordIssuance({
          security, kind: action, quantity,
          attestationId: body.attestationId ?? null,
          txHash: body.txHash ?? null,
          actor: String(body.actor ?? "admin"),
        });
        return NextResponse.json({ ok: true, id, backing: await backing(security) });
      } catch (e) {
        // A refusal here is the invariant doing its job, not a server fault.
        return NextResponse.json(
          { ok: false, error: e instanceof Error ? e.message : "issuance refused" },
          { status: 409 },
        );
      }
    }

    if (action === "reconcile") {
      const security = String(body.security ?? "").trim().toUpperCase();
      try {
        const r = await reconcileIssuance(security, {
          txHash: body.txHash ?? null,
          actor: String(body.actor ?? "admin"),
        });
        return NextResponse.json({ ok: true, ...r, backing: await backing(security) });
      } catch (e) {
        return NextResponse.json(
          { ok: false, error: e instanceof Error ? e.message : "reconciliation refused" },
          { status: 409 },
        );
      }
    }

    if (action === "check-issue") {
      const security = String(body.security ?? "").trim().toUpperCase();
      const verdict = await canIssue(security, Number(body.quantity));
      // `ok` here means the request succeeded; whether issuance is permitted
      // is a separate answer, so it gets its own name rather than colliding.
      return NextResponse.json({
        ok: true,
        allowed: verdict.ok,
        reason: verdict.reason ?? null,
        backing: verdict.backing,
      });
    }

    if (action === "request-issuance") {
      return requestIssuance(sql, role, body);
    }
    if (action === "approve-request" || action === "reject-request") {
      const id = String(body.id ?? "");
      const next = action === "approve-request" ? "approved" : "rejected";
      if (next === "approved") {
        // Checked again at approval: custody may have moved since the ask.
        const [r] = await sql<{ security: string; kind: string; quantity: number }[]>`
          select security, kind, quantity::float8 as quantity from capx.issuance_requests
           where id = ${id}::uuid and status = 'pending'`;
        if (!r) return NextResponse.json({ ok: false, error: "No pending request with that id." }, { status: 404 });
        if (r.kind === "mint") {
          const v = await canIssue(r.security, r.quantity);
          if (!v.ok) return NextResponse.json({ ok: false, error: v.reason }, { status: 409 });
        } else {
          const refusal = await burnRefusal(r.security, r.quantity);
          if (refusal) return NextResponse.json({ ok: false, error: refusal }, { status: 409 });
        }
      }
      await sql`update capx.issuance_requests
                   set status = ${next}, decided_by = ${ACTOR[role]}, decided_at = now()
                 where id = ${id}::uuid and status = 'pending'`;
      return NextResponse.json({ ok: true });
    }
    if (action === "complete-request") {
      return completeRequest(sql, role, body);
    }
    if (action === "execute-burn") {
      return executeBurn(sql, role, body);
    }

    return NextResponse.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "custody action failed" },
      { status: 500 },
    );
  }
}


type Sql = ReturnType<typeof db>;

/**
 * Asking for tokens, which is not the same as creating them.
 *
 * A mint request is refused up front when custody could not cover it, so a
 * request in the queue is always one that could be approved today. Nothing
 * moves on-chain here; that takes the issuer key, which this server does not
 * hold.
 */
async function requestIssuance(sql: Sql, role: OpsRole, body: Record<string, unknown>) {
  const security = String(body.security ?? "").trim().toUpperCase();
  const kind = body.kind === "burn" ? "burn" : "mint";
  const quantity = Number(body.quantity);
  if (!security || !(quantity > 0)) {
    return NextResponse.json({ ok: false, error: "A security and a positive quantity are required." }, { status: 400 });
  }
  if (kind === "mint") {
    const v = await canIssue(security, quantity);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.reason }, { status: 409 });
  } else {
    const refusal = await burnRefusal(security, quantity);
    if (refusal) return NextResponse.json({ ok: false, error: refusal }, { status: 409 });
  }
  const [row] = await sql<{ id: string }[]>`
    insert into capx.issuance_requests (security, kind, quantity, note, requested_by)
    values (${security}, ${kind}, ${quantity}, ${body.note ? String(body.note).slice(0, 500) : null}, ${ACTOR[role]})
    returning id::text`;
  return NextResponse.json({ ok: true, id: row.id });
}

/**
 * Closing a request against the transaction that carried it out.
 *
 * The hash is not taken on trust: the receipt has to exist, have succeeded,
 * and have been sent to this security's token. Supply is then reconciled from
 * the chain, so the log records what the chain says was minted rather than
 * what the form said would be.
 */
async function completeRequest(sql: Sql, role: OpsRole, body: Record<string, unknown>) {
  const id = String(body.id ?? "");
  const txHash = String(body.txHash ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    return NextResponse.json({ ok: false, error: "That is not a transaction hash." }, { status: 400 });
  }
  const [r] = await sql<{ security: string; kind: string; token_address: string | null }[]>`
    select r.security, r.kind, s.token_address
      from capx.issuance_requests r left join capx.securities s on s.symbol = r.security
     where r.id = ${id}::uuid and r.status = 'approved'`;
  if (!r) return NextResponse.json({ ok: false, error: "No approved request with that id." }, { status: 404 });
  if (!r.token_address) {
    return NextResponse.json({ ok: false, error: `${r.security} has no token registered yet.` }, { status: 409 });
  }

  const { publicClient } = await import("@/lib/chain");
  // Waited for briefly: a hash handed over the moment it is mined can be a
  // block ahead of the node this server reads from.
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 20_000 })
    .catch(() => null);
  if (!receipt) return NextResponse.json({ ok: false, error: "That transaction is not on Base yet. Wait for it to confirm." }, { status: 409 });
  if (receipt.status !== "success") return NextResponse.json({ ok: false, error: "That transaction reverted." }, { status: 409 });
  /*
   * Judged by what the transaction did, not where it was addressed.
   *
   * Checking `to` against the token turned away a real mint: MetaMask routes
   * transactions from an upgraded (EIP-7702) account through its own
   * delegation contract, so `to` is that contract even though the token did
   * the minting. The event is the proof either way — a Transfer from the zero
   * address, emitted by this token. For a burn, a Transfer to it.
   */
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const ZERO = "0x" + "0".repeat(64);
  const token = r.token_address.toLowerCase();
  const moved = receipt.logs.some((l) =>
    l.address.toLowerCase() === token && l.topics[0] === TRANSFER &&
    (r.kind === "mint" ? l.topics[1] === ZERO : l.topics[2] === ZERO));
  if (!moved) {
    return NextResponse.json(
      { ok: false, error: `That transaction did not ${r.kind} any ${r.security} tokens.` },
      { status: 409 },
    );
  }

  let added = 0;
  try {
    added = r.kind === "mint"
      ? (await reconcileIssuance(r.security, { txHash, actor: ACTOR[role] })).added
      : -(await recordBurnFromChain(r.security, { txHash, actor: ACTOR[role] })).burned;
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "reconcile failed" }, { status: 409 });
  }
  await sql`update capx.issuance_requests set status = 'executed', tx_hash = ${txHash}, executed_at = now()
             where id = ${id}::uuid`;
  return NextResponse.json({ ok: true, added, backing: await backing(r.security) });
}


/**
 * Why a burn of this size may not happen, or null when it may.
 *
 * Only tokens nobody is owed can be burned. Every token in the treasury is
 * either inventory or the backing for a customer's shares, and burning the
 * second kind would leave a customer's holding backed by nothing — the one
 * outcome this whole system exists to prevent.
 */
async function burnRefusal(security: string, quantity: number): Promise<string | null> {
  if (!(quantity > 0)) return "Quantity must be greater than zero.";
  const b = await backing(security);
  if (quantity > b.unallocated) {
    return `Only ${b.unallocated.toLocaleString()} ${security} can be burned: the other ` +
      `${b.clientHeld.toLocaleString()} back customers' shares.`;
  }
  return null;
}

/**
 * Burning from the treasury, which is where the tokens are.
 *
 * B20's burn takes tokens from the caller's own balance, and every token sits
 * in the treasury, so the treasury signs it. It needs the token's burn role,
 * which the issuer grants once from the desk. Checked against unallocated
 * inventory again at the moment of burning, since customers may have bought
 * since the request was approved.
 */
async function executeBurn(sql: Sql, role: OpsRole, body: Record<string, unknown>) {
  const id = String(body.id ?? "");
  const [r] = await sql<{ security: string; kind: string; quantity: number; token_address: string | null; decimals: number }[]>`
    select r.security, r.kind, r.quantity::float8 as quantity, s.token_address, s.decimals
      from capx.issuance_requests r left join capx.securities s on s.symbol = r.security
     where r.id = ${id}::uuid and r.status = 'approved' and r.kind = 'burn'`;
  if (!r) return NextResponse.json({ ok: false, error: "No approved burn with that id." }, { status: 404 });
  if (!r.token_address) return NextResponse.json({ ok: false, error: `${r.security} has no token.` }, { status: 409 });
  const refusal = await burnRefusal(r.security, r.quantity);
  if (refusal) return NextResponse.json({ ok: false, error: refusal }, { status: 409 });

  const { treasuryWrite } = await import("@/lib/treasury");
  const { parseUnits } = await import("viem");
  let hash: `0x${string}`;
  try {
    hash = await treasuryWrite({
      address: r.token_address as `0x${string}`,
      abi: [{ type: "function", name: "burn", stateMutability: "nonpayable",
              inputs: [{ name: "amount", type: "uint256" }], outputs: [] }],
      functionName: "burn",
      args: [parseUnits(String(r.quantity), r.decimals)],
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    return NextResponse.json(
      { ok: false, error: /e2517d3f|AccessControl|Unauthorized/i.test(m)
          ? `The treasury does not have the burn role on ${r.security}t yet. Grant it from the security's card.`
          : `The burn was not sent: ${m.slice(0, 200)}` },
      { status: 409 },
    );
  }
  return completeRequest(sql, role, { id, txHash: hash });
}
