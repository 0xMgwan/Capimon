import type { Metadata } from "next";
import { Leaderboard } from "@/components/Leaderboard";

export const metadata: Metadata = {
  title: "Top traders",
  description: "Customers who have chosen to publish their trading on CAPX, ranked by volume and by return.",
};

export default function LeaderboardPage() {
  return <Leaderboard />;
}
