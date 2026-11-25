import { NextResponse, after } from "next/server";
import { dbConfigured, db, migrate } from "@/lib/db";
import { verifySignature } from "@/lib/ntzsWebhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * nTZS telling us the money landed, instead of us asking.
 *
 * Everything else in this codebase learns about a collection by polling: a
 * cron every ten minutes, a watcher for the ninety seconds after a prompt is
 * sent, a partner reading their deposits. All of that is CAPX going to look.
 * This is the other direction, and for one funding route it is the only
 * direction that works — a bank push has no prompt to watch and no window to
 * watch it in. Somebody transfers at eleven and goes to lunch; the statement
 * sync matches it at twenty past; nothing CAPX scheduled was awake for either.
 *
 * So the credit happens when nTZS says it happened. The sweep stays as the
 * backstop it has always been, because a webhook that is not delivered must
 * not be the only thing standing between a customer and their money.
 *
 * ## What is trusted here
 *
 * The signature, and nothing else. The body names a deposit; it does not get
 * to say what the deposit is worth. Settlement re-reads the deposit from nTZS
 * by its own id and credits the amount nTZS reports there, exactly as the
 * cron does — so a forged or replayed body, if one ever got past the HMAC,
 * could at most make CAPX look at a deposit sooner than it would have.
 */

const SECRET = (process.env.NTZS_WEBHOOK_SECRET ?? "").trim();

export async function POST(req: Request) {
  /* The raw bytes, because the signature is over them. Parsing first and
     re-serialising would verify a different string than the one that was
     signed, and would start failing the first time nTZS changed key order. */
  const raw = await req.text();

  if (!verifySignature({
    raw,
    signature: req.headers.get("x-webhook-signature") ?? "",
    timestamp: req.headers.get("x-webhook-timestamp") ?? "",
    secret: SECRET,
  })) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 400 });
  }

  let envelope: { event?: string; data?: Record<string, unknown> } = {};
  try { envelope = JSON.parse(raw); } catch { /* answered below */ }

  const event = String(envelope.event ?? "");
  const data = envelope.data ?? {};

  /*
   * Acknowledged first, worked afterwards.
   *
   * nTZS wants a 2xx within ten seconds and retries twice before marking the
   * event failed. Settling can involve a round trip back to nTZS and a ledger
   * write, which is comfortably inside ten seconds and not worth betting a
   * delivery on.
   */
  after(async () => {
    try {
      if (!dbConfigured) return;
      if (event !== "deposit.completed") return;

      const depositId = String(data.depositId ?? "");
      if (!depositId) return;

      await migrate();
      /* Ours, by nTZS's own id for it. A deposit we have no row for is not an
         error: nTZS also mints for things that are not CAPX collections. */
      const [row] = await db()<{ user_id: string }[]>`
        select user_id::text from capx.deposits where ntzs_deposit_id = ${depositId}`;
      if (!row) return;

      const { settlePending } = await import("@/app/api/ntzs/settle/route");
      await settlePending(row.user_id);
    } catch {
      /* The sweep is the backstop. A handler that threw must not cause nTZS
         to retry an event that was received correctly. */
    }
  });

  /* Always 200 on a verified delivery, including for events this does not act
     on. Answering anything else asks nTZS to redeliver something that was
     received perfectly well and simply did not concern us. */
  return NextResponse.json({ received: true });
}
