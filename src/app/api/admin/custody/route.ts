import { NextResponse } from "next/server";
import { db, migrate, dbConfigured } from "@/lib/db";
import { backing, canIssue, recordIssuance, reconcileIssuance } from "@/lib/custody";
import { roleOf, ACTOR, type OpsRole } from "@/lib/adminAuth";
import { SECURITIES_CONTRACTS } from "@/lib/assets";
import { treasuryAddress } from "@/lib/treasury";

export const dynamic = "force-dynamic";

/** What FIMCO may do. Everything else on this route is CAPX's. */
const FIMCO_ACTIONS = new Set(["attest", "request-issuance"]);

/** Attestations and issuance history for the custody desk. */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  const role = roleOf(req);
  if (!role) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  try {
    await migrate();
    const sql = db();
    const [securities, attestations, issuance, requests] = await Promise.all([
      sql`select symbol, name, token_address, decimals, chain_id, status from capx.securities order by symbol`,
      sql`select id::text, security, custodian, quantity::float8 as quantity, locked::float8 as locked,
                 doc_ref, issued_at, expires_at, status, approved_by, approved_at, filed_by,
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

      await sql`
        insert into capx.securities (symbol, name, token_address, decimals, chain_id, status)
        values (${symbol}, ${name}, ${tokenAddress}, ${decimals},
                ${Number(body.chainId ?? 8453)}, ${String(body.status ?? "draft")})
        on conflict (symbol) do update
          set name = excluded.name,
              token_address = coalesce(excluded.token_address, capx.securities.token_address),
              decimals = excluded.decimals,
              chain_id = excluded.chain_id,
              status = excluded.status`;
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
      const rows = await sql<{ id: string }[]>`
        insert into capx.custody_attestations (security, custodian, quantity, locked, doc_ref, expires_at, status, filed_by)
        values (${security}, ${custodian}, ${quantity}, ${locked},
                ${docRef}, ${expiresAt}, 'pending', ${ACTOR[role]})
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
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null);
  if (!receipt) return NextResponse.json({ ok: false, error: "That transaction is not on Base yet. Wait for it to confirm." }, { status: 409 });
  if (receipt.status !== "success") return NextResponse.json({ ok: false, error: "That transaction reverted." }, { status: 409 });
  if ((receipt.to ?? "").toLowerCase() !== r.token_address.toLowerCase()) {
    return NextResponse.json({ ok: false, error: `That transaction was not sent to the ${r.security} token.` }, { status: 409 });
  }

  let added = 0;
  if (r.kind === "mint") {
    try {
      added = (await reconcileIssuance(r.security, { txHash, actor: ACTOR[role] })).added;
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "reconcile failed" }, { status: 409 });
    }
  }
  await sql`update capx.issuance_requests set status = 'executed', tx_hash = ${txHash}, executed_at = now()
             where id = ${id}::uuid`;
  return NextResponse.json({ ok: true, added, backing: await backing(r.security) });
}
