import type { Metadata } from "next";
import { CrdbPanel } from "@/components/CrdbPanel";
import { CrdbChart } from "@/components/CrdbChart";
import { CrdbIntro } from "@/components/CrdbIntro";
import { Comments } from "@/components/Comments";
import { TradeFeed } from "@/components/TradeFeed";

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
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-3 sm:px-6 sm:pt-10">
      <CrdbIntro />
      <CrdbChart />
      <div className="mt-3" />
      <CrdbPanel showHeader={false} />
      {/* Who has been trading this one, under the ticket rather than over it. */}
      <div className="mt-3"><TradeFeed symbol="CRDB" /></div>
      <Comments symbol="CRDB" />
    </main>
  );
}
