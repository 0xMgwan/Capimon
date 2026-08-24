import type { Metadata } from "next";
import { Suspense } from "react";
import { PortfolioView } from "@/components/PortfolioView";

export const metadata: Metadata = {
  title: "Portfolio — CAPIMON",
  description: "Your B20 equity positions on Base, read straight from the chain and marked live.",
};

export default function PortfolioPage() {
  return (
    // useSearchParams needs a boundary so the shell can still prerender.
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <PortfolioView />
    </Suspense>
  );
}
