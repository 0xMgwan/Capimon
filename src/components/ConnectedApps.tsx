"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * The apps a customer has connected, and the way out.
 *
 * Shown only when there is something to show. An empty panel explaining a
 * feature nobody is using is furniture on a settings page that already has
 * plenty.
 */
type Link = { id: string; partner: string; reference: string;
              consented_at: string | null; status: string };

export function ConnectedApps() {
  const { t } = useT();
  const [links, setLinks] = useState<Link[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/account/partners", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setLinks(j.partners ?? []);
    } catch { /* nothing to show is the same as nothing connected */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const disconnect = async (id: string) => {
    setBusy(true);
    try {
      await fetch("/api/account/partners", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally { setBusy(false); }
  };

  if (!links?.length) return null;

  return (
    <section className="mt-3 rounded-3xl border hairline p-5">
      <div className="eyebrow">{t("Connected apps")}</div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
        {t("These apps can see your balances and holdings and can buy and sell on your behalf. They cannot change your password or withdraw to an account you have not set up. Disconnecting takes effect immediately.")}
      </p>
      <ul className="mt-3 divide-y hairline">
        {links.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span className="font-medium">{l.partner}</span>
            <span className="text-xs text-[var(--muted)]">
              {l.consented_at
                ? `${t("connected")} ${new Date(l.consented_at).toLocaleDateString("en-GB")}`
                : null}
            </span>
            <button
              onClick={() => void disconnect(l.id)}
              disabled={busy}
              className="ml-auto rounded-full border hairline px-4 py-1.5 text-xs disabled:opacity-50"
            >
              {t("Disconnect")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
