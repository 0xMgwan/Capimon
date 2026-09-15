import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { TickerTape } from "@/components/TickerTape";
import { DseTape } from "@/components/DseTape";
import { MobileTabs } from "@/components/MobileTabs";

/*
 * One superfamily, carrying the whole page.
 *
 * Archivo is variable on both weight and width, so the display type can run
 * wide and heavy while an accent runs condensed and italic — the contrast that
 * used to need a second and third typeface now comes out of one skeleton, and
 * the page reads as a set rather than a pairing that happens to sit together.
 * It also means one font file instead of three.
 */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  axes: ["wdth"],
  style: ["normal", "italic"],
});
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", weight: ["400", "500", "600"] });

// Set NEXT_PUBLIC_SITE_URL once a custom domain is live; VERCEL_PROJECT_PRODUCTION_URL
// keeps preview deployments pointing at themselves in the meantime.
const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://capx.vercel.app");
const DESCRIPTION =
  "Buy and sell public equities onchain as B20 tokens on Base. US shares in dollars, " +
  "CRDB Bank in shillings. Live marks, settlement against custody published onchain, " +
  "and self-custody. No broker, no closing bell.";

export const metadata: Metadata = {
  // Resolves relative OG and icon URLs so crawlers get absolute links.
  metadataBase: new URL(SITE),
  title: {
    default: "CAPX · Capital markets in motion",
    template: "%s · CAPX",
  },
  description: DESCRIPTION,
  applicationName: "CAPX",
  keywords: ["tokenized equities", "B20", "Base", "onchain stocks", "Chainlink", "self-custody",
    "CRDB", "Dar es Salaam Stock Exchange", "DSE", "Tanzania", "nTZS"],
  openGraph: {
    title: "CAPX · Capital markets in motion",
    description: DESCRIPTION,
    siteName: "CAPX",
    url: SITE,
    type: "website",
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: "CAPX · Capital markets in motion",
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
    /*
      * The font variables go on <html>, not <body>.
      *
      * `--font-sans` and friends are declared at :root and reference
      * `--font-archivo`. A custom property that references an undefined
      * variable is invalid at computed-value time, so with the font class on
      * <body> the reference failed at :root and every one of those tokens
      * computed to nothing — the whole site rendered in the system stack and
      * had been doing so the entire time, through three different typefaces.
      * Defining the variable at the same level the tokens are read from is
      * what makes any of them apply.
      */
    <html lang="en" className={`${archivo.variable} ${jbmono.variable}`} suppressHydrationWarning>
      <head>
        {/* Light is the default. Dark is opt-in and remembered, applied before
            paint so the first frame never flashes the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('capx-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        {/* Motion emits inline initial styles; without JS they would hide content. */}
        <noscript>
          <style>{`[style*="opacity:0"],[style*="opacity: 0"]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body>
        <Providers>
          <div className="sticky top-0 z-50">
            <DseTape />
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
