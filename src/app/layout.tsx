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

// Set NEXT_PUBLIC_SITE_URL once a custom domain is live; VERCEL_PROJECT_PRODUCTION_URL
// keeps preview deployments pointing at themselves in the meantime.
const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://capimon.vercel.app");
const DESCRIPTION =
  "Buy and sell public equities onchain as B20 tokens on Base. Live Chainlink marks, " +
  "aggregated routing across every venue, and self-custody — no broker, no closing bell.";

export const metadata: Metadata = {
  // Resolves relative OG and icon URLs so crawlers get absolute links.
  metadataBase: new URL(SITE),
  title: {
    default: "CAPIMON — Capital markets in motion",
    template: "%s — CAPIMON",
  },
  description: DESCRIPTION,
  applicationName: "CAPIMON",
  keywords: ["tokenized equities", "B20", "Base", "onchain stocks", "Chainlink", "self-custody"],
  openGraph: {
    title: "CAPIMON — Capital markets in motion",
    description: DESCRIPTION,
    siteName: "CAPIMON",
    url: SITE,
    type: "website",
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: "CAPIMON — Capital markets in motion",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
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
