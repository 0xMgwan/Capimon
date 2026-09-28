import type { Metadata } from "next";
import { LiquidityDesk } from "@/components/LiquidityDesk";

export const metadata: Metadata = { title: "Liquidity provider desk", robots: { index: false } };

/**
 * Where a provider watches their own facility.
 *
 * Off the main navigation and out of the index: a provider reaches it with a
 * link and their token, the same way FIMCO reaches the custody portal.
 */
export default function LiquidityPage() {
  return <LiquidityDesk />;
}
