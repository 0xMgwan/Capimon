import type { Metadata } from "next";
import { DseOversight } from "@/components/DseOversight";

export const metadata: Metadata = {
  title: "DSE oversight portal",
  robots: { index: false, follow: false },
};

/**
 * The exchange's window onto CAPX's Dar es Salaam book.
 *
 * Deliberately not under /admin. The operations panel is CAPX's own and the
 * tokens that open it operate the business; this is a counterparty's portal
 * with its own token that operates nothing, and putting it on a different
 * path keeps that distinction visible in the URL as well as in the code.
 */
export default function DsePortalPage() {
  return <DseOversight />;
}
