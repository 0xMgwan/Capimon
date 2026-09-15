import type { Metadata } from "next";
import { ProofOfReserves } from "@/components/ProofOfReserves";

export const metadata: Metadata = {
  title: "Proof of reserves",
  description: "Every tokenised security, the custody behind it, and the backing ratio, live.",
};

export default function ProofPage() {
  return <ProofOfReserves />;
}
