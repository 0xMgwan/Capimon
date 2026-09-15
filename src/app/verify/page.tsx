import type { Metadata } from "next";
import { KycFlow } from "@/components/KycFlow";
import { VerifyIntro } from "@/components/VerifyIntro";

export const metadata: Metadata = {
  title: "Verify your account",
  description: "Confirm your identity to keep using your CAPX account.",
};

export default function VerifyPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-5 pb-20 pt-8 sm:px-8 sm:pt-10">
      <VerifyIntro />
      <div className="mt-6">
        <KycFlow />
      </div>
    </main>
  );
}
