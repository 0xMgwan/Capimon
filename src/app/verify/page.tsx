import type { Metadata } from "next";
import { KycFlow } from "@/components/KycFlow";

export const metadata: Metadata = {
  title: "Verify your account",
  description: "Confirm your identity to keep using your CAPX account.",
};

export default function VerifyPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-5 pb-20 pt-8 sm:px-8 sm:pt-10">
      <div className="eyebrow">Verification</div>
      <h1 className="display mt-1.5 text-[clamp(1.5rem,3.4vw,2.1rem)]">Confirm it&rsquo;s you.</h1>
      <p className="mt-2.5 max-w-md text-sm leading-relaxed text-[var(--muted)]">
        Two photographs: the document you hold, and you holding the phone. It takes about a
        minute and only has to be done once.
      </p>
      <div className="mt-6">
        <KycFlow />
      </div>
    </main>
  );
}
