import { partnerRoute, send, sendFail, fail } from "@/lib/partnerApi";
import { usageFor, keysFor, issueKey, revokeKey } from "@/lib/partners";
import { db, migrate } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Everything a partner can see about themselves. */
export const GET = partnerRoute("GET /partner/me", {}, async ({ caller }) => {
  const [usage, keys] = await Promise.all([
    usageFor(caller.partner.id), keysFor(caller.partner.id),
  ]);
  return send({
    ok: true,
    partner: caller.partner,
    mode: caller.mode,
    usage,
    keys: keys.map((k) => ({
      id: k.id, mode: k.mode, label: k.label, prefix: k.key_prefix,
      last_used_at: k.last_used_at, created_at: k.created_at, revoked: !!k.revoked_at,
    })),
  });
});

/**
 * The few things a partner may change about themselves.
 *
 * Their webhook, and their own keys. Not their limits, their fee share or
 * their status — those are the agreement, and a party to an agreement does
 * not get to edit it from their own dashboard.
 */
export const POST = partnerRoute("POST /partner/me", {}, async ({ caller, body }) => {
  await migrate();
  const sql = db();
  const action = String(body.action ?? "");

  if (action === "rotate_key") {
    const mode = body.mode === "live" ? "live" : "test";
    if (mode === "live" && caller.partner.status !== "approved") {
      return sendFail(fail("not_approved", "Live keys are issued once CAPX approves you.", 403));
    }
    const key = await issueKey(caller.partner.id, mode, String(body.label ?? "") || undefined);
    return send({ ok: true, key,
      note: "Copy it now — only its hash is stored. Revoke the old one when you have swapped it in." });
  }

  if (action === "revoke_key") {
    const id = String(body.key_id ?? "");
    if (!id) return sendFail(fail("key_required", "Name the key with `key_id`."));
    if (id === caller.keyId) {
      return sendFail(fail("cannot_revoke_self",
        "That is the key you are calling with. Rotate first, then revoke this one with the new key.",
        409));
    }
    await revokeKey(caller.partner.id, id);
    return send({ ok: true });
  }

  if (action === "set_webhook") {
    const url = String(body.webhook_url ?? "").trim();
    if (url && !/^https:\/\//i.test(url)) {
      return sendFail(fail("https_required", "A webhook URL must be https."));
    }
    /* A fresh secret with every URL change: a secret that outlives the
       endpoint it was shared with is a secret shared with two endpoints. */
    const { randomBytes } = await import("crypto");
    const secret = url ? `whsec_${randomBytes(24).toString("base64url")}` : null;
    await sql`
      update capx.partners set webhook_url = ${url || null}, webhook_secret = ${secret}
       where id = ${caller.partner.id}::uuid`;
    return send({ ok: true, webhook_url: url || null, webhook_secret: secret,
      note: secret
        ? "Every delivery is signed: capx-signature: sha256=HMAC_SHA256(secret, raw_body). "
          + "Copy the secret now; it is shown once."
        : "Webhook cleared." });
  }

  return sendFail(fail("unknown_action",
    "`action` must be rotate_key, revoke_key or set_webhook."));
});
