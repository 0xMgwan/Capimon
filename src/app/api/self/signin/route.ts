import { NextResponse } from "next/server";
import { db, dbConfigured, migrate } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { requireDb, bad, boom } from "@/lib/apiHelpers";
import { linkMessage } from "@/lib/walletLink";
import { randomBytes } from "crypto";
import { verifyMessage } from "viem";

export const dynamic = "force-dynamic";

/**
 * Signing in with a wallet that is already linked to an account.
 *
 * Only ever a second door to an account that exists. A wallet cannot open one
 * — an account carries a verified identity and a wallet carries none — so an
 * address nobody has linked is turned away rather than quietly given a new
 * account with no name behind it.
 *
 * The signature proves the same thing linking proved, which is why this uses
 * the same challenge: only whoever holds the key can produce it, and the
 * nonce stops one being replayed.
 */
const NONCE_TTL_MINUTES = 10;

export async function POST(req: Request) {
  const gate = requireDb();
  if (gate) return gate;
  try {
    const body = await req.json();
    const address = String(body.address ?? "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return bad("That is not a Base address.");

    await migrate();
    const sql = db();

    const [link] = await sql<{ user_id: string; username: string | null; name: string | null }[]>`
      select w.user_id::text, u.username, u.name
        from capx.wallet_links w join capx.users u on u.id = w.user_id
       where lower(w.address) = ${address} and w.verified_at is not null and w.revoked_at is null`;
    if (!link) {
      return bad(
        "This wallet is not linked to a CAPX account. Sign in first, then link it from your account.",
        "not_linked",
        404,
      );
    }

    /*
     * Step one: a challenge, stored against the link row.
     *
     * Reusing the link table's nonce column rather than inventing a second
     * place for the same kind of secret — it is the same address, the same
     * question, and two stores would be two things to keep consistent.
     */
    if (!body.signature) {
      const nonce = randomBytes(16).toString("hex");
      await sql`
        update capx.wallet_links set nonce = ${nonce}, nonce_at = now()
         where lower(address) = ${address} and revoked_at is null`;
      return NextResponse.json({
        ok: true,
        nonce,
        message: linkMessage(address, nonce),
        account: { username: link.username, name: link.name },
      });
    }

    const [row] = await sql<{ nonce: string | null; fresh: boolean }[]>`
      select nonce, (nonce_at > now() - make_interval(mins => ${NONCE_TTL_MINUTES})) as fresh
        from capx.wallet_links
       where lower(address) = ${address} and revoked_at is null`;
    if (!row?.nonce || !row.fresh) return bad("That request has expired. Try again.");

    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message: linkMessage(address, row.nonce),
      signature: String(body.signature) as `0x${string}`,
    }).catch(() => false);
    if (!valid) return bad("That signature does not match the address.");

    // Spend the nonce whether or not anything else happens next.
    await sql`update capx.wallet_links set nonce = null where lower(address) = ${address}`;

    await createSession(link.user_id, "wallet");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return boom(e, "Could not sign you in with that wallet");
  }
}
