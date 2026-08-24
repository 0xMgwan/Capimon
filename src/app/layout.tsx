import type { Metadata, Viewport } from "next";
import { Outfit, Figtree, Newsreader, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { TickerTape } from "@/components/TickerTape";
import { MobileTabs } from "@/components/MobileTabs";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", weight: ["200", "300", "400", "500", "600"] });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", weight: ["300", "400", "500", "600", "700"] });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", weight: ["300", "400", "500"], style: ["normal", "italic"] });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "CAPIMON — Capital markets, onchain",
  description:
    "CAPIMON brings public equities onchain as B20 tokens on Base. Live Chainlink marks, real onchain supply, 24/5 markets, self-custody.",
  openGraph: {
    title: "CAPIMON — Capital markets, onchain",
    description: "Tokenized equities on Base. Live prices, real onchain data, self-custody.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
  width: "device-width",
  initialScale: 1,
  // Fills the notch area on phones; zoom stays enabled for accessibility.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Light is the default. Dark is opt-in and remembered, applied before
            paint so the first frame never flashes the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('capimon-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        {/* Motion emits inline initial styles; without JS they would hide content. */}
        <noscript>
          <style>{`[style*="opacity:0"],[style*="opacity: 0"]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body className={`${outfit.variable} ${figtree.variable} ${newsreader.variable} ${jbmono.variable}`}>
        <Providers>
          <div className="sticky top-0 z-50">
            <TickerTape />
            <Nav />
          </div>
          <main className="safe-x">{children}</main>
          <Footer />
          <MobileTabs />
        </Providers>
      </body>
    </html>
  );
}
