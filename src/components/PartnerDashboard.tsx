"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A partner's own desk: what they have built, and the keys that reach it.
 *
 * Opened with their API key, the same one their server uses, because a second
 * credential for the dashboard would be a second thing to lose. Nothing here
 * can change the agreement — limits, fee share and status are CAPX's side and
 * are shown read-only, so a partner can always see the terms they are being
 * held to without being able to edit them.
 */

type Usage = {
  users: number; verified: number; orders: number;
  volumeTzs: number; volumeUsdc: number;
  daily: { day: string; orders: number; tzs: number }[];
};
type Key = { id: string; mode: string; label: string | null; prefix: string;
             last_used_at: string | null; created_at: string; revoked: boolean };
type Partner = {
  id: string; name: string; slug: string; status: string; contactEmail: string;
  country: string; feeBps: number; maxOrderTzs: number | null; maxDailyTzs: number | null;
  webhookUrl: string | null;
};
type Data = { partner: Partner; mode: string; usage: Usage; keys: Key[] };

const tzs = (n: number) => `${Math.round(n).toLocaleString()} TZS`;
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border hairline p-4">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div>}
    </div>
  );
}

const STATUS_COPY: Record<string, string> = {
  pending: "Your application is being read. Test keys work; live calls are refused until approval.",
  approved: "Approved. Your live key moves real money — keep it server-side.",
  suspended: "Suspended. Calls are refused until CAPX lifts it.",
  rejected: "This application was not accepted.",
};

export function PartnerDashboard() {
  const [key, setKey] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ what: string; value: string } | null>(null);
  const [hook, setHook] = useState("");

  const load = useCallback(async (k: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/partner/me", { headers: { authorization: `Bearer ${k}` } });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "That key was not accepted.");
      setData(j);
      setHook(j.partner.webhookUrl ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open the dashboard.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!data || !key) return;
    const id = setInterval(() => void load(key), 60_000);
    return () => clearInterval(id);
  }, [data, key, load]);

  const act = async (body: Record<string, unknown>, label?: string) => {
    setBusy(true); setErr(null); setIssued(null);
    try {
      const r = await fetch("/api/partner/me", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "That did not work.");
      if (j.key) setIssued({ what: label ?? "New key", value: j.key });
      if (j.webhook_secret) setIssued({ what: "Webhook signing secret", value: j.webhook_secret });
      await load(key);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 sm:py-24">
        <div className="eyebrow">Partners</div>
        <h1 className="display mt-3 text-3xl">Your dashboard.</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Open it with any of your API keys — the same one your server uses. A test key is enough.
        </p>
        <input
          value={key} onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(key); }}
          type="password" placeholder="cpx_live_… or cpx_test_…"
          className="mt-6 w-full rounded-xl border hairline bg-transparent px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          onClick={() => void load(key)} disabled={busy || !key}
          className="mt-3 w-full rounded-full bg-[var(--fg)] py-3 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
        >
          {busy ? "Checking…" : "Open dashboard"}
        </button>
        {err && <p className="mt-3 text-xs text-[var(--color-down)]">{err}</p>}
        <p className="mt-6 text-xs text-[var(--muted)]">
          No key yet? <a href="/partners" className="underline underline-offset-2">Apply for access</a>.
        </p>
      </div>
    );
  }

  const { partner, usage } = data;
  const peak = Math.max(1, ...usage.daily.map((d) => d.tzs));

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 pt-6 sm:px-8 sm:pt-12">
      <div className="eyebrow">Partners · {data.mode} key</div>
      <h1 className="display mt-2 text-[clamp(1.8rem,5vw,2.8rem)]">{partner.name}.</h1>
      <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
        {STATUS_COPY[partner.status] ?? partner.status}
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Customers" value={usage.users.toLocaleString()}
              hint={`${usage.verified.toLocaleString()} verified and able to buy`} />
        <Stat label="Orders settled" value={usage.orders.toLocaleString()} />
        <Stat label="Shilling volume" value={tzs(usage.volumeTzs)} hint="Dar es Salaam board" />
        <Stat label="Dollar volume" value={usd(usage.volumeUsdc)} hint="US board" />
      </div>

      {usage.daily.some((d) => d.tzs > 0) && (
        <div className="mt-8 rounded-2xl border hairline p-5">
          <div className="eyebrow">Shilling volume, 30 days</div>
          <div className="mt-4 flex h-24 items-end gap-[3px]">
            {usage.daily.map((d) => (
              <div key={d.day} title={`${d.day}: ${tzs(d.tzs)}`}
                   className="flex-1 rounded-sm bg-[var(--fg)]/70"
                   style={{ height: `${Math.max(2, (d.tzs / peak) * 100)}%` }} />
            ))}
          </div>
        </div>
      )}

      <section className="mt-10 rounded-3xl border hairline p-5 sm:p-7">
        <h2 className="text-lg font-medium">Keys</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Only the hash of a key is stored, so none of these can be shown again. Rotate, swap it
          into your server, then revoke the old one — in that order, so you are never without a
          working key.
        </p>

        <ul className="mt-4 divide-y hairline text-sm">
          {data.keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className={`rounded-full border hairline px-2 py-0.5 text-[11px] ${
                k.mode === "live" ? "text-[var(--color-up)]" : "text-[var(--muted)]"}`}>
                {k.mode}
              </span>
              <code className="text-xs">{k.prefix}…</code>
              <span className="text-xs text-[var(--muted)]">
                {k.label ?? "—"} · {k.last_used_at
                  ? `last used ${new Date(k.last_used_at).toLocaleDateString("en-GB")}`
                  : "never used"}
              </span>
              <span className="ml-auto">
                {k.revoked ? (
                  <span className="text-xs text-[var(--muted)]">revoked</span>
                ) : (
                  <button
                    onClick={() => void act({ action: "revoke_key", key_id: k.id })}
                    disabled={busy}
                    className="rounded-full border hairline px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={() => void act({ action: "rotate_key", mode: "test" }, "New test key")}
                  disabled={busy}
                  className="rounded-full border hairline px-5 py-2.5 text-sm font-medium disabled:opacity-50">
            New test key
          </button>
          <button onClick={() => void act({ action: "rotate_key", mode: "live" }, "New live key")}
                  disabled={busy || partner.status !== "approved"}
                  className="rounded-full border hairline px-5 py-2.5 text-sm font-medium disabled:opacity-40">
            New live key
          </button>
        </div>

        {issued && (
          <div className="mt-4 rounded-2xl border hairline p-4">
            <div className="text-xs text-[var(--muted)]">{issued.what} — shown once.</div>
            <code className="mt-2 block break-all text-sm">{issued.value}</code>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-3xl border hairline p-5 sm:p-7">
        <h2 className="text-lg font-medium">Webhook</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          We post customer and order events here. Every delivery carries{" "}
          <code className="text-[11px]">capx-signature: sha256=…</code>, an HMAC of the raw body
          with your signing secret — verify it before trusting a payload, because the URL is the
          only other thing protecting it.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <input
            value={hook} onChange={(e) => setHook(e.target.value)}
            placeholder="https://your-server/capx/webhook"
            className="min-w-[260px] flex-1 rounded-xl border hairline bg-transparent px-4 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button onClick={() => void act({ action: "set_webhook", webhook_url: hook })}
                  disabled={busy}
                  className="rounded-full border hairline px-5 py-2.5 text-sm font-medium disabled:opacity-50">
            Save
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border hairline p-5 sm:p-7">
        <h2 className="text-lg font-medium">Your terms</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Set by CAPX and shown here so you always know what you are held to. Blank means no limit
          is agreed and nothing is refused on that ground.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Your fee share" value={`${(partner.feeBps / 100).toFixed(2)}%`}
                hint="of the platform fee on orders you bring" />
          <Stat label="Max single order"
                value={partner.maxOrderTzs === null ? "no limit" : tzs(partner.maxOrderTzs)} />
          <Stat label="Max per day"
                value={partner.maxDailyTzs === null ? "no limit" : tzs(partner.maxDailyTzs)} />
        </div>
      </section>

      {err && <p className="mt-4 text-xs text-[var(--color-down)]">{err}</p>}
    </div>
  );
}
