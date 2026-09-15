import Link from "next/link";
import { Lockup } from "./Logo";
import { B20_REGISTRY } from "@/lib/assets";

const COLS = [
  {
    title: "Invest",
    links: [
      { label: "All markets", href: "/markets" },
      { label: "Open an account", href: "/join" },
      { label: "Portfolio", href: "/portfolio" },
      { label: "Apple · AAPLc", href: "/markets/aapl" },
      { label: "NVIDIA · NVDAc", href: "/markets/nvda" },
    ],
  },
  {
    title: "Protocol",
    links: [
      { label: "How it works", href: "/how-it-works" },
      { label: "B20 standard", href: "https://docs.base.org/base-chain/specs/upgrades/beryl/b20/specification", ext: true },
      { label: "Tokenized stocks on Base", href: "https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base", ext: true },
      { label: "Onchain registry", href: `https://basescan.org/address/${B20_REGISTRY}`, ext: true },
    ],
  },
  {
    title: "Data",
    links: [
      { label: "Live market API", href: "/api/markets", ext: true },
      { label: "Routable venues", href: "/api/venues", ext: true },
      { label: "Chainlink feeds", href: "https://data.chain.link/base/base", ext: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t hairline">
      <div className="mx-auto max-w-[1400px] px-5 py-10 sm:px-8 sm:py-16">
        {/*
          * Three short link lists stacked on a phone is a lot of scrolling for
          * nine links. They sit side by side instead, which is what the eye
          * expects of a footer and what the column widths can easily take.
          */}
        <div className="grid gap-8 md:grid-cols-[1.4fr_repeat(3,1fr)] md:gap-10">
          <div>
            <Lockup />
            <p className="mt-3 max-w-xs text-[15px] leading-snug text-[var(--muted)] sm:text-[17px]">
              Public markets, rebuilt as open infrastructure. Priced by live oracles,
              held in your own wallet.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-5 md:contents">
          {COLS.map((c) => (
            <div key={c.title}>
              <div className="eyebrow">{c.title}</div>
              <ul className="mt-3 space-y-2 md:mt-4 md:space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {"ext" in l && l.ext ? (
                      <a href={l.href} target="_blank" rel="noreferrer"
                        className="text-[13px] leading-snug text-[var(--muted)] transition-colors hover:text-[var(--fg)] sm:text-sm">
                        {l.label}&nbsp;↗
                      </a>
                    ) : (
                      <Link href={l.href} className="text-[13px] leading-snug text-[var(--muted)] transition-colors hover:text-[var(--fg)] sm:text-sm">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          </div>
        </div>

        <div className="mt-14 border-t hairline pt-6">
          <p className="max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
            CAPX is an interface to B20 tokenized equities issued on Base. Connected wallets are
            self-custodied; accounts funded in Tanzanian shillings are held by CAPX on the
            holder&rsquo;s behalf. It is not a
            broker-dealer, exchange, or investment adviser, and nothing here is investment advice.
            Tokenized equities are not available to US persons. One B20 token is not permanently one
            share; redemption applies the current onchain multiplier. Mint and redeem are performed
            by the issuer under KYC; secondary transfers are permissionless subject to onchain policy.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="tnum text-xs text-[var(--muted)]">CAPX © {new Date().getFullYear()}</span>
            <span className="eyebrow">Built on B20</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
