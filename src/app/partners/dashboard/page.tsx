import type { Metadata } from "next";
import { PartnerDashboard } from "@/components/PartnerDashboard";

export const metadata: Metadata = { title: "Partner dashboard · CAPX", robots: { index: false } };

export default function PartnerDashboardPage() {
  return <PartnerDashboard />;
}
