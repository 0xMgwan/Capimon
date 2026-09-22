import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { TickerTape } from "@/components/TickerTape";
import { DseTape } from "@/components/DseTape";
import { MobileTabs } from "@/components/MobileTabs";
import { ThemeColor } from "@/components/ThemeColor";
import { Haptics } from "@/components/Haptics";

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
  "Buy Tanzanian shares like CRDB and NMB, and US shares like Apple and NVIDIA, " +
  "all in shillings from mobile money or your bank. Settled the same day, from TSh 2,000.";

export const metadata: Metadata = {
  // Resolves relative OG and icon URLs so crawlers get absolute links.
  metadataBase: new URL(SITE),
  title: {
    default: "CAPX · Capital in Motion",
    template: "%s · CAPX",
  },
  description: DESCRIPTION,
  applicationName: "CAPX",
  keywords: ["Tanzania stocks", "DSE", "Dar es Salaam Stock Exchange", "CRDB", "NMB",
    "US stocks", "buy shares in shillings", "mobile money investing", "M-Pesa", "CAPX"],
  openGraph: {
    title: "CAPX · Tanzanian & US shares, in shillings",
    description: DESCRIPTION,
    siteName: "CAPX",
    url: SITE,
    type: "website",
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: "CAPX · Tanzanian & US shares, in shillings",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
  /* Home-screen app on iOS: full screen, its own title, a status bar that
     sits above the page rather than over it. */
  appleWebApp: { capable: true, title: "CAPX", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // The page's own light background; ThemeColor switches it with the theme.
  themeColor: "#fcfcfb",
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
            __html: `try{if(localStorage.getItem('capx-theme')==='dark'){document.documentElement.classList.add('dark');var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','#0b0c0b')}}catch(e){}`,
          }}
        />
        {/* Motion emits inline initial styles; without JS they would hide content. */}
        <noscript>
          <style>{`[style*="opacity:0"],[style*="opacity: 0"]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body>
        <Providers>
          <div className="safe-t sticky top-0 z-50 bg-[var(--bg)]">
            {/* The full DSE board, from tablets up. On a phone two tapes ate the
                top of the screen; the main ticker already leads with the
                listings CAPX trades. */}
            <div className="hidden sm:block"><DseTape /></div>
            <TickerTape />
            <Nav />
          </div>
          <main className="safe-x">{children}</main>
          <Footer />
          <MobileTabs />
          <Haptics />
          <ThemeColor />
        </Providers>
      </body>
    </html>
  );
}
