import Link from "next/link";
import { Lockup } from "./Logo";
import { B20_REGISTRY } from "@/lib/assets";

const COLS = [
  {
    title: "Invest",
    links: [
      { label: "All markets", href: "/markets" },
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
      { label: "Base network", href: "https://base.org", ext: true },
      { label: "BaseScan", href: "https://basescan.org", ext: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t hairline">
      <div className="mx-auto max-w-[1400px] px-5 py-16 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Lockup />
            <p className="mt-4 max-w-xs font-[family-name:var(--font-serif)] text-[17px] leading-snug text-[var(--muted)]">
              Public markets, rebuilt as open infrastructure. Settled on Base, priced by Chainlink,
              held in your own wallet.
            </p>
          </div>

          {COLS.map((c) => (
            <div key={c.title}>
              <div className="eyebrow">{c.title}</div>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {"ext" in l && l.ext ? (
                      <a href={l.href} target="_blank" rel="noreferrer"
                        className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
                        {l.label} ↗
                      </a>
                    ) : (
                      <Link href={l.href} className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t hairline pt-6">
          <p className="max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
            CAPIMON is a non-custodial interface to B20 tokenized equities issued on Base. It is not a
            broker-dealer, exchange, or investment adviser, and nothing here is investment advice.
            Tokenized equities are not available to US persons. One B20 token is not permanently one
            share — redemption applies the current onchain multiplier. Mint and redeem are performed
            by the issuer under KYC; secondary transfers are permissionless subject to onchain policy.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="tnum text-xs text-[var(--muted)]">CAPIMON © {new Date().getFullYear()} · Base mainnet · chain 8453</span>
            <span className="eyebrow">Built on B20</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
