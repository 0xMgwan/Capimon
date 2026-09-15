import type { Metadata } from "next";
import { HowItWorksView } from "@/components/HowItWorksView";

export const metadata: Metadata = {
  title: "How it works",
  description: "The B20 standard, Chainlink total-return feeds, multipliers and onchain policy. What CAPX is actually reading.",
};

export default function HowItWorks() {
  return <HowItWorksView />;
}
