"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { wagmiConfig } from "@/lib/wallets";
import { MarketsProvider } from "@/lib/useMarkets";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true } },
  }));

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MarketsProvider>{children}</MarketsProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
