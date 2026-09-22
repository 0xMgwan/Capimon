import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db, migrate, dbConfigured } from "@/lib/db";
import { backing, canIssue, recordIssuance, reconcileIssuance } from "@/lib/custody";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

function authorised(req: Request) {
  if (!ADMIN_TOKEN) return false;
  const url = new URL(req.url);
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
    || url.searchParams.get("token") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Attestations and issuance history for the custody desk. */
export async function GET(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  try {
    await migrate();
    const sql = db();
    const [securities, attestations, issuance] = await Promise.all([
      sql`select symbol, name, token_address, decimals, chain_id, status from capx.securities order by symbol`,
      sql`select id::text, security, custodian, quantity::float8 as quantity, locked::float8 as locked,
                 doc_ref, issued_at, expires_at, status, approved_by, approved_at,
                 (expires_at <= now()) as expired
            from capx.custody_attestations order by created_at desc limit 50`,
      sql`select id::text, security, kind, quantity::float8 as quantity, tx_hash, actor, created_at
            from capx.issuance_events order by created_at desc limit 50`,
    ]);

    const withBacking = await Promise.all(
      (securities as unknown as { symbol: string }[]).map(async (s) => ({ ...s, backing: await backing(s.symbol) })),
    );

    return NextResponse.json(
      { ok: true, securities: withBacking, attestations, issuance },
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
  if (!authorised(req)) return NextResponse.json({ ok: false, code: "unauthorised" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
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
      const custodian = String(body.custodian ?? "").trim();
      const docRef = String(body.docRef ?? "").trim();
      if (!custodian || !docRef) {
        return NextResponse.json({ ok: false, error: "An attestation needs the attesting party and their statement reference." }, { status: 400 });
      }
      const rows = await sql<{ id: string }[]>`
        insert into capx.custody_attestations (security, custodian, quantity, locked, doc_ref, expires_at, status)
        values (${security}, ${custodian}, ${quantity}, ${locked},
                ${docRef}, ${expiresAt}, 'pending')
        returning id::text`;
      return NextResponse.json({ ok: true, id: rows[0].id });
    }

    if (action === "approve-attestation") {
      const id = String(body.id ?? "");
      if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
      await sql`update capx.custody_attestations
                   set status = 'approved', approved_by = ${String(body.approvedBy ?? "admin")}, approved_at = now()
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

    return NextResponse.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "custody action failed" },
      { status: 500 },
    );
  }
}
