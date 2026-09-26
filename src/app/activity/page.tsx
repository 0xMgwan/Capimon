import type { Metadata } from "next";
import { ActivityView } from "@/components/ActivityView";

export const metadata: Metadata = {
  title: "Activity",
  description: "Every deposit, trade and withdrawal on your CAPX account, with the receipt for each one.",
  // Somebody's own transaction history is not something to hand a crawler.
  robots: { index: false, follow: false },
};

export default function ActivityPage() {
  return (
    <main>
      <ActivityView />
    </main>
  );
}
