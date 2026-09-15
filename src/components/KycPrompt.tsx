"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { useT } from "@/lib/i18n";

/**
 * Tells a signed-in customer their account still needs verifying.
 *
 * Shown only while there is something for them to do. Once a submission is
 * pending it becomes a status line rather than a prompt, and once approved it
 * disappears entirely — a banner that stays after the thing it asks for is done
 * teaches people to ignore banners.
 */
type Kyc = { status: string; reason: string | null };

export function KycPrompt() {
  const { t } = useT();
  const { account } = useCapimonAccount();
  const [kyc, setKyc] = useState<Kyc | null>(null);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    fetch("/api/account/kyc", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setKyc({ status: j.status, reason: j.reason }); })
      .catch(() => { /* silence is better than a wrong banner */ });
    return () => { alive = false; };
  }, [account]);

  if (!account || !kyc) return null;
  if (kyc.status === "approved") return null;

  if (kyc.status === "pending") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border hairline px-4 py-3">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#b45309]" />
        <p className="text-[13px] text-[var(--muted)]">
          {t("Your verification is being reviewed. Nothing to do.")}
        </p>
      </div>
    );
  }

  const rejected = kyc.status === "rejected";
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 ${
      rejected
        ? "border-[var(--color-down)]/40 bg-[var(--color-down)]/[0.06]"
        : "border-[#b45309]/40 bg-[#b45309]/[0.06]"}`}>
      <p className={`flex-1 text-[13px] ${rejected ? "text-[var(--color-down)]" : "text-[#b45309]"}`}>
        {rejected
          ? kyc.reason
            ? `Verification was not accepted: ${kyc.reason}`
            : t("Verification was not accepted. Please submit again.")
          : t("Verify your identity to keep using your account.")}
      </p>
      <Link
        href="/verify"
        className="shrink-0 rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-medium text-[var(--bg)]"
      >
        {t(rejected ? "Try again" : "Verify now")}
      </Link>
    </div>
  );
}
