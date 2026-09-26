"use client";

import { useCapimonAccount } from "@/lib/useCapimonAccount";
import { HomePortal } from "./HomePortal";

/**
 * Which home a visitor gets.
 *
 * The marketing page is an argument for opening an account, and every word of
 * it is addressed to somebody who has not. A customer signing in on a phone
 * landed on thirteen swipes of being persuaded of something they had already
 * done, with their own balance nowhere on the screen.
 *
 * So a signed-in phone gets the portal instead. A wide screen keeps the full
 * page — there is room for the argument there, and a desktop visitor is more
 * often the person still deciding. The split is CSS rather than a width
 * measurement, so the server and the first paint agree.
 *
 * While the account is still loading, the phone shows a placeholder rather
 * than the marketing page: swapping a hero for a balance a beat after it
 * lands is worse than a moment of nothing.
 */
export function HomeGate({ children }: { children: React.ReactNode }) {
  const { account, loading } = useCapimonAccount();

  if (loading) {
    return (
      <>
        <div className="px-4 pt-6 md:hidden">
          <div className="h-32 animate-pulse rounded-3xl surface" />
        </div>
        <div className="hidden md:block">{children}</div>
      </>
    );
  }

  if (!account) return <>{children}</>;

  return (
    <>
      <div className="md:hidden"><HomePortal /></div>
      <div className="hidden md:block">{children}</div>
    </>
  );
}
