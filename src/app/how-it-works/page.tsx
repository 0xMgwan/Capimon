import type { Metadata } from "next";
import Link from "next/link";
import { Reveal, RevealWords } from "@/components/Reveal";
import { B20_REGISTRY, ASSETS } from "@/lib/assets";

export const metadata: Metadata = {
  title: "How it works — CAPIMON",
  description: "The B20 standard, Chainlink total-return feeds, multipliers and onchain policy — what CAPIMON is actually reading.",
};

const STEPS = [
  {
    n: "01",
    t: "The issuer mints a B20 token",
    b: "A regulated issuer holds the underlying share and mints a matching B20 token on Base. B20 extends ERC-20 for real-world assets and is asset-agnostic. These tokens are native precompiles rather than separately deployed contracts, audited by Base and Spearbit with ongoing Cantina and HackerOne bounty coverage.",
    refs: [{ label: "B20 specification", href: "https://docs.base.org/base-chain/specs/upgrades/beryl/b20/specification" }],
  },
  {
    n: "02",
    t: "Chainlink publishes a total-return mark",
    b: "Each asset has a Chainlink feed on Base reporting price × multiplier, WAD-scaled, running 24/5 and freezing through corporate actions. CAPIMON reads updatedAt on every round and flags a feed that has missed a session instead of showing you a confident number that isn't.",
    refs: [{ label: "Chainlink on Base", href: "https://data.chain.link/base/base" }],
  },
  {
    n: "03",
    t: "Corporate actions move the multiplier",
    b: "Splits and dividends do not rewrite balances. They adjust a WAD-precision multiplier, so one token is not permanently one share. CAPIMON applies the current multiplier everywhere a share count appears — portfolio quantities use scaledBalanceOf, and supply figures are multiplier-adjusted share-equivalents.",
    refs: [],
  },
  {
    n: "04",
    t: "Policies gate transfers, not holding",
    b: "Onchain policy registries enforce allowlists and blocklists, and a transfer to a sanctioned address reverts. Holding and secondary transfer are otherwise permissionless — KYC applies at mint and redeem with the issuer, not between wallets.",
    refs: [{ label: "Onchain registry", href: `https://basescan.org/address/${B20_REGISTRY}` }],
  },
  {
    n: "05",
    t: "CAPIMON reads, you sign",
    b: "Prices, supply and balances are read straight from Base. Trades are routed by aggregating every venue on the chain — Aerodrome concentrated liquidity, Uniswap v3 and v4, PancakeSwap — because equity liquidity moves between them and no single pool tells the truth. Every fill is checked against the Chainlink mark before it is offered, and CAPIMON refuses to route anything more than 15% away from it.",
    refs: [
      { label: "Live market API", href: "/api/markets" },
      { label: "Routable venues", href: "/api/venues" },
    ],
  },
];

const FAQ = [
  {
    q: "Is one token one share?",
    a: "No. Redemption applies the current onchain multiplier, which absorbs splits and dividends. CAPIMON shows the multiplier on every asset page and adjusts every share count it displays.",
  },
  {
    q: "Why does an asset show zero onchain supply?",
    a: "The Chainlink feed is live for all thirteen assets, but tokens are only minted as demand arrives. A supply of zero means nothing has been minted on Base yet — the mark is still real, there is just nothing to trade against.",
  },
  {
    q: "Why can't I trade every asset?",
    a: "Secondary trading needs minted supply and a venue holding it. Four assets route today at roughly the oracle mark; the rest have nothing minted on Base yet, so CAPIMON marks them mint-only rather than inventing a fill. The markets table labels each one.",
  },
  {
    q: "Who can use this?",
    a: "Tokenized equities are not available to US persons. CAPIMON is a non-custodial interface, not a broker-dealer, exchange, or investment adviser, and nothing here is investment advice.",
  },
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-12 sm:px-8">
      <Reveal>
        <div className="eyebrow">How it works</div>
        <h1 className="display mt-4 max-w-4xl text-[clamp(2.2rem,6vw,5rem)]">
          <RevealWords text="No black box." />{" "}
          <span className="font-[family-name:var(--font-serif)] font-light italic text-[var(--muted)]">
            <RevealWords text="Just addresses." delay={0.12} />
          </span>
        </h1>
        <p className="mt-6 max-w-xl font-[family-name:var(--font-serif)] text-lg leading-relaxed text-[var(--muted)]">
          CAPIMON is a thin, honest interface over machinery that already exists on Base. Here is exactly
          what it reads, and where you can check it yourself.
        </p>
      </Reveal>

      <div className="mt-16 grid gap-12 lg:grid-cols-[1fr_360px]">
        <div>
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.05}>
              <div className="border-b hairline py-9 first:border-t">
                <div className="flex gap-6">
                  <span className="tnum shrink-0 text-sm text-[var(--muted)]">{s.n}</span>
                  <div>
                    <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.04em]">{s.t}</h2>
                    <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">{s.b}</p>
                    {s.refs.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {s.refs.map((r) => (
                          <a key={r.href} href={r.href} target="_blank" rel="noreferrer"
                            className="rounded-full border hairline px-3 py-1.5 text-xs transition-colors hover:surface">
                            {r.label} ↗
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <div className="lg:sticky lg:top-32 lg:self-start">
            <div className="rounded-3xl border hairline p-6">
              <div className="eyebrow">Contracts CAPIMON reads</div>
              <div className="scroll-thin mt-4 max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                {ASSETS.map((a) => (
                  <div key={a.symbol} className="flex items-center justify-between gap-3 text-xs">
                    <Link href={`/markets/${a.ticker.toLowerCase()}`} className="flex items-center gap-2 hover:opacity-70">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.color }} />
                      <span className="font-medium">{a.symbol}</span>
                    </Link>
                    <a href={`https://basescan.org/address/${a.token}`} target="_blank" rel="noreferrer"
                      className="tnum text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
                      {a.token.slice(0, 8)}…{a.token.slice(-4)} ↗
                    </a>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t hairline pt-4 text-[11px] leading-relaxed text-[var(--muted)]">
                Every B20 address begins 0xb2 — they are native precompiles on Base, not deployed bytecode.
              </p>
            </div>
          </div>
        </Reveal>
      </div>

      <Reveal className="mt-20">
        <h2 className="display text-[clamp(1.8rem,4vw,3rem)]">Straight answers</h2>
        <div className="mt-8 grid gap-px overflow-hidden rounded-3xl bg-[var(--border)] md:grid-cols-2">
          {FAQ.map((f) => (
            <div key={f.q} className="bg-[var(--bg)] p-7">
              <h3 className="font-[family-name:var(--font-display)] text-lg font-medium tracking-[-0.03em]">{f.q}</h3>
              <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--muted)]">{f.a}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="mt-16">
        <div className="flex flex-wrap gap-3">
          <Link href="/markets" className="rounded-full bg-[var(--fg)] px-6 py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03]">
            Explore markets →
          </Link>
          <a href="https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base" target="_blank" rel="noreferrer"
            className="rounded-full border hairline px-6 py-3.5 text-sm font-medium transition-colors hover:surface">
            Base documentation ↗
          </a>
        </div>
      </Reveal>
    </div>
  );
}
