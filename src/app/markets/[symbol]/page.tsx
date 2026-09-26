import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ASSETS, BY_SYMBOL } from "@/lib/assets";
import { AssetView } from "@/components/AssetView";
import { dseSecurity } from "@/lib/dseSecurities";
import { CrdbPanel } from "@/components/CrdbPanel";
import { CrdbChart } from "@/components/CrdbChart";
import { CrdbIntro } from "@/components/CrdbIntro";
import { Comments } from "@/components/Comments";
import { TradeFeed } from "@/components/TradeFeed";

/*
 * US tickers are generated at build time; a DSE listing registered on the desk
 * afterwards is rendered on request, so NMB gets a page the moment its token
 * is registered rather than at the next deploy.
 */
export const dynamicParams = true;
/* Re-checked every minute, so taking a draft live (or suspending one) shows
   up without a redeploy instead of the first render being cached for good. */
export const revalidate = 60;

export function generateStaticParams() {
  return ASSETS.map((a) => ({ symbol: a.ticker.toLowerCase() }));
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  const a = BY_SYMBOL[symbol.toLowerCase()];
  if (!a) {
    const d = await dseSecurity(symbol).catch(() => null);
    if (!d || d.status === "draft") return { title: "Not found" };
    return {
      title: `${d.symbol} · ${d.name}`,
      description: `Buy and sell tokenised ${d.name} shares in shillings, settled against a published custody position on Base.`,
    };
  }
  return {
    title: `${a.ticker} · ${a.name}`,
    description: `Live ${a.symbol} price, onchain supply and B20 contract detail on Base. ${a.blurb}`,
  };
}

export default async function AssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const asset = BY_SYMBOL[symbol.toLowerCase()];
  if (!asset) {
    // Not a US ticker: a tokenised DSE share, if one is registered and not a draft.
    const d = await dseSecurity(symbol).catch(() => null);
    if (!d || d.status === "draft") notFound();
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-3 sm:px-6 sm:pt-10">
        <CrdbIntro symbol={d.symbol} name={d.name} />
        <CrdbChart symbol={d.symbol} external={d.kind === "external"} />
        <div className="mt-3" />
        <CrdbPanel symbol={d.symbol} showHeader={false} />
        <div className="mt-3"><TradeFeed symbol={d.symbol} /></div>
        <Comments symbol={d.symbol} />
      </main>
    );
  }
  // The trade panel reads ?side= and ?amount= from the quick-buy handoff.
  return (
    <Suspense fallback={<div className="min-h-[70vh]" />}>
      <AssetView asset={asset} />
    </Suspense>
  );
}
