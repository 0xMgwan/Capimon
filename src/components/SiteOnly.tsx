"use client";

import { usePathname } from "next/navigation";
import { isDeskPath } from "@/lib/desks";

/**
 * Chrome that belongs to the website and not to a desk.
 *
 * Wraps the price tapes and the live trade feed in the root layout. On the
 * DSE portal those are not merely out of place, they are contradictory: the
 * page states that no US security appears on it while the tape above it
 * quotes Apple and the feed announces somebody selling NVDAc. Rendering
 * nothing is the honest version.
 */
export function SiteOnly({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (isDeskPath(path)) return null;
  return <>{children}</>;
}
