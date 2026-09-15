import type { Metadata } from "next";
import { CrdbPanel } from "@/components/CrdbPanel";

export const metadata: Metadata = {
  title: "CRDB Bank Plc",
  description: "Buy and sell tokenised CRDB Bank Plc shares in shillings, settled against a published custody position on Base.",
};

/**
 * A static segment, so it takes precedence over `[symbol]`.
 *
 * CRDB is not in the Chainlink asset list that generates those pages, and it is
 * priced and settled differently enough that generating it from the same
 * template would mean branching on the asset at every step.
 */
export default function CrdbPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <div className="mb-6">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">CRDB Bank Plc</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
          Tanzania&rsquo;s largest bank by assets, listed on the Dar es Salaam Stock Exchange.
          One CRDBt is one share, held in custody and settled in shillings.
        </p>
      </div>
      <CrdbPanel />
    </main>
  );
}
