"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCapimonAccount } from "@/lib/useCapimonAccount";

/**
 * Where "/" sends a customer who already has an account.
 *
 * The landing page is an argument for opening one, and every word of it is
 * addressed to somebody who has not. On a phone a signed-in customer who taps
 * the wordmark got thirteen swipes of being persuaded of something they had
 * already done, with their own balance nowhere on the screen.
 *
 * So the phone goes to the portfolio, which is home now — the tab bar already
 * points there, and this is the one remaining way to arrive at the landing
 * page by accident. `replace`, not `push`: the marketing page should not be
 * sitting in the back stack of somebody who never asked for it.
 *
 * A wide screen keeps the page. There is room for the argument there, and a
 * desktop visitor is more often the person still deciding.
 */
export function HomeGate({ children }: { children: React.ReactNode }) {
  const { account, loading } = useCapimonAccount();
  const router = useRouter();

  useEffect(() => {
    if (loading || !account) return;
    // Read in an effect, so the server and the first paint agree on what to
    // render and only the navigation depends on the width.
    if (window.innerWidth >= 768) return;
    router.replace("/portfolio");
  }, [account, loading, router]);

  return <>{children}</>;
}
