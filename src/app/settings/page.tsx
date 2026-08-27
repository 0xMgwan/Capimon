import type { Metadata } from "next";
import { SettingsView } from "@/components/SettingsView";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your CAPX account details.",
};

export default function SettingsPage() {
  return <SettingsView />;
}
