import type { Metadata } from "next";
import { JoinFlow } from "@/components/JoinFlow";

export const metadata: Metadata = {
  title: "Open an account",
  description:
    "Fund with Tanzanian shillings over mobile money, convert to USDC, and buy tokenized equities from a wallet you control.",
};

export default function JoinPage() {
  return <JoinFlow />;
}
