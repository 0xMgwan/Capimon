import type { Metadata } from "next";
import { ResetPassword } from "@/components/ResetPassword";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Choose a new password for your CAPX account.",
  // A one-time link is not something to hand to a crawler.
  robots: { index: false, follow: false },
};

export default function ResetPage() {
  return (
    <main className="mx-auto w-full max-w-md px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
      <ResetPassword />
    </main>
  );
}
