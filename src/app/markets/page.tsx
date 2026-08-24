import type { Metadata } from "next";
import { MarketsView } from "@/components/MarketsView";

export const metadata: Metadata = {
  title: "Markets — CAPIMON",
  description: "Every B20 tokenized equity live on Base, marked by Chainlink total-return feeds.",
};

export default function MarketsPage() {
  return <MarketsView />;
}
