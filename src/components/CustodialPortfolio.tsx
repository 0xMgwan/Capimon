"use client";

import Link from "next/link";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { AssetLogo } from "./AssetLogo";
import { Counter } from "./Counter";
import { Reveal } from "./Reveal";
import { WalletSection } from "./WalletSection";
import { usd } from "@/lib/format";

/** The book CAPX holds for a shilling-funded account. */
export function CustodialPortfolio() {
  const { account, signOut } = useCapimonAccount();
  if (!account) return null;

  const { tzs, cashTzs, positions, equity, total } = account;
  const shillings = tzs + (cashTzs ?? 0);

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-12 sm:px-8">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="eyebrow">Portfolio</div>
            <h1 className="display mt-3 text-[clamp(1.65rem,5vw,3.6rem)]">Your book.</h1>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
              {account.user.username ? `@${account.user.username}` : account.user.email}
              <span className="rounded-full surface px-2 py-0.5 text-[11px]">held by CAPX</span>
              <button onClick={signOut} className="underline underline-offset-2 hover:text-[var(--fg)]">Sign out</button>
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-2xl bg-[var(--border)] lg:w-auto">
            <Cell label="Shares" value={<Counter value={equity} format={usd} />} />
            <Cell label="Cash" value={<Counter value={shillings} format={(n) => `${Math.round(n).toLocaleString()} TZS`} />} />
            <Cell label="Total value" value={<Counter value={total} format={usd} />} />
          </div>
        </div>
      </Reveal>

      {positions.length > 0 && (
        <Reveal delay={0.06} className="mt-10">
          <div id="holdings" className="grid gap-2 scroll-mt-24">
            {positions.map((p) => (
              <Link
                key={p.symbol}
                href={`/markets/${p.ticker.toLowerCase()}`}
                className="flex items-center gap-3 rounded-2xl border hairline p-4 transition-colors hover:surface"
              >
                <AssetLogo logo={p.logo} ticker={p.ticker} color={p.color} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">{p.ticker}</div>
                  <div className="tnum text-xs text-[var(--muted)]">
                    {p.qty.toFixed(6)} @ {usd(p.price)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tnum text-[15px] font-medium">{usd(p.value)}</div>
                  <div className={`tnum text-xs ${p.change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                    {p.change >= 0 ? "+" : ""}{p.change.toFixed(2)}%
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      <WalletSection />

      <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
        CAPX holds these assets on your behalf and this ledger records what you are owed. Prefer
        to hold your own keys? <Link href="/markets" className="underline underline-offset-2">Connect a wallet</Link> and
        CAPX holds nothing.
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg)] px-3 py-3 sm:px-5 sm:py-4">
      <div className="eyebrow truncate">{label}</div>
      <div className="tnum mt-1.5 text-base font-medium sm:text-lg">{value}</div>
    </div>
  );
}
