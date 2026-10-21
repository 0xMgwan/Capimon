import type { Metadata } from "next";
import { PartnersAdmin } from "@/components/PartnersAdmin";

export const metadata: Metadata = { title: "Partners · CAPX operations", robots: { index: false } };

export default function AdminPartnersPage() {
  return <PartnersAdmin />;
}
