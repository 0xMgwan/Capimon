import type { Metadata } from "next";
import { SecuritiesDesk } from "@/components/SecuritiesDesk";

export const metadata: Metadata = { title: "Securities desk", robots: { index: false } };

export default function SecuritiesAdminPage() {
  return <SecuritiesDesk />;
}
