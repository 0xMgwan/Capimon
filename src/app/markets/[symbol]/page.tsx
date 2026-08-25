import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ASSETS, BY_SYMBOL } from "@/lib/assets";
import { AssetView } from "@/components/AssetView";

export function generateStaticParams() {
  return ASSETS.map((a) => ({ symbol: a.ticker.toLowerCase() }));
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  const a = BY_SYMBOL[symbol.toLowerCase()];
  if (!a) return { title: "Not found" };
  return {
    title: `${a.ticker} · ${a.name}`,
    description: `Live ${a.symbol} price, onchain supply and B20 contract detail on Base. ${a.blurb}`,
  };
}

export default async function AssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const asset = BY_SYMBOL[symbol.toLowerCase()];
  if (!asset) notFound();
  // The trade panel reads ?side= and ?amount= from the quick-buy handoff.
  return (
    <Suspense fallback={<div className="min-h-[70vh]" />}>
      <AssetView asset={asset} />
    </Suspense>
  );
}
