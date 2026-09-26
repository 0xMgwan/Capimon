"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { pollWhileVisible } from "@/lib/usePoll";
import { useT } from "@/lib/i18n";

/**
 * Trades made into this wallet, on the page that reads it.
 *
 * The onchain book says what is held; it said nothing about how any of it got
 * there. A wallet holding 0.13 CRDB with no record of the two trades that
 * made it is a balance without a story, and the story is the part somebody
 * checks when a number looks wrong.
 *
 * Only settled and in-flight orders, and only this account's. The full
 * receipt for each lives on Activity — this is the short version, next to
 * the positions it explains.
 */
type Order = {
  reference: string; security: string; side: "buy" | "sell";
  qty: number; netUsdc: number; status: string;
  settleTx: string | null; createdAt: string;
};

const qtyFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 8 });

export function SelfCustodyOrders() {
  const { t } = useT();
  const { account } = useCapimonAccount();
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    if (!account) { setOrders([]); return; }
    let alive = true;
    const load = () => {
      fetch("/api/self/order", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (alive) setOrders(j.ok ? (j.orders ?? []) : []); })
        .catch(() => { if (alive) setOrders([]); });
    };
    load();
    const stop = pollWhileVisible(load, 30_000);
    // A trade just made should appear without waiting out the poll.
    const onSettled = () => load();
    window.addEventListener("capx:settled", onSettled);
    return () => { alive = false; stop(); window.removeEventListener("capx:settled", onSettled); };
  }, [account]);

  if (!orders || orders.length === 0) return null;

  return (
    <section className="mt-10 rounded-2xl border hairline p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow">{t("Trades into this wallet")}</span>
        <Link href="/activity" className="text-[11px] text-[var(--muted)] underline underline-offset-2 hover:text-[var(--fg)]">
          {t("All activity")}
        </Link>
      </div>

      <div className="mt-3 grid gap-1.5">
        {orders.slice(0, 6).map((o) => (
          <div key={o.reference} className="flex items-center gap-3 rounded-xl surface px-3.5 py-2.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              o.status === "settled" ? (o.side === "buy" ? "bg-[var(--color-up)]" : "bg-[var(--color-down)]")
              : o.status === "failed" ? "bg-[var(--color-down)]" : "bg-[#b45309]"}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {t(o.side === "buy" ? "Bought" : "Sold")} {qtyFmt(o.qty)} {o.security}
              </span>
              <span className="block truncate text-[11px] text-[var(--muted)]">
                {new Date(o.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                {o.status !== "settled" && ` · ${t(o.status === "failed" ? "Failed" : "Pending")}`}
              </span>
            </span>
            <span className="tnum shrink-0 text-[13px]">
              {o.side === "buy" ? "−" : "+"}${o.netUsdc.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
