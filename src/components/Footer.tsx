import Link from "next/link";
import { Lockup } from "./Logo";

/*
 * Links a customer would look for. The developer ones — the B20 spec, the
 * registry, Chainlink, raw APIs — were accurate but read as a manual for the
 * plumbing; the proof page and How it works already cover what they showed.
 */
const COLS = [
  {
    title: "Invest",
    links: [
      { label: "All markets", href: "/markets" },
      { label: "CRDB Bank", href: "/markets/crdb" },
      { label: "NMB Bank", href: "/markets/nmb" },
      { label: "Open an account", href: "/join" },
      { label: "Portfolio", href: "/portfolio" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "How it works", href: "/how-it-works" },
      { label: "Proof of reserves", href: "/proof" },
      { label: "Terms of service", href: "/terms" },
      { label: "Privacy policy", href: "/privacy" },
    ],
  },
] as { title: string; links: { label: string; href: string; ext?: boolean }[] }[];

export function Footer() {
  return (
    <footer className="border-t hairline">
      <div className="mx-auto max-w-[1400px] px-5 py-10 sm:px-8 sm:py-16">
        {/*
          * Three short link lists stacked on a phone is a lot of scrolling for
          * nine links. They sit side by side instead, which is what the eye
          * expects of a footer and what the column widths can easily take.
          */}
        <div className="grid gap-8 md:grid-cols-[2fr_repeat(2,1fr)] md:gap-10">
          <div>
            <Lockup />
            <p className="mt-3 max-w-xs text-[15px] leading-snug text-[var(--muted)] sm:text-[17px]">
              Public markets, rebuilt as open infrastructure. Priced by live oracles,
              held in your own wallet.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 md:contents">
          {COLS.map((c) => (
            <div key={c.title}>
              <div className="eyebrow">{c.title}</div>
              <ul className="mt-2.5 space-y-1.5 md:mt-4 md:space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {"ext" in l && l.ext ? (
                      <a href={l.href} target="_blank" rel="noreferrer"
                        className="block text-[13px] leading-[1.35] text-[var(--muted)] transition-colors hover:text-[var(--fg)] sm:text-sm sm:leading-snug">
                        {l.label}&nbsp;↗
                      </a>
                    ) : (
                      <Link href={l.href} className="block text-[13px] leading-[1.35] text-[var(--muted)] transition-colors hover:text-[var(--fg)] sm:text-sm sm:leading-snug">
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
            CAPX lets you buy shares listed on the Dar es Salaam Stock Exchange, and US shares,
            with Tanzanian shillings. Shares bought through a CAPX account are held on your behalf
            by CAPX with a licensed DSE broker. CAPX is not an exchange or an investment adviser,
            and nothing here is investment advice. Share prices can fall as well as rise. US shares
            are not available to US persons.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="tnum text-xs text-[var(--muted)]">CAPX © {new Date().getFullYear()}</span>
            <span className="eyebrow">Capital in Motion</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
