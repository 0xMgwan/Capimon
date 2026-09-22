import type { Metadata } from "next";
import { SecuritiesDesk } from "@/components/SecuritiesDesk";

export const metadata: Metadata = { title: "FIMCO custody portal", robots: { index: false } };

/**
 * FIMCO's view of the desk.
 *
 * The same component as /admin/securities, so both parties are always looking
 * at the same figures. What each can do is decided by the token, not the URL:
 * FIMCO's token files and requests; the CAPX admin token opens this page too
 * and sees the approval controls on it.
 */
export default function FimcoPortalPage() {
  return <SecuritiesDesk portal="fimco" />;
}
