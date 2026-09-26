"use client";

import Link from "next/link";
import { Reveal, RevealWords } from "@/components/Reveal";
import { ASSETS } from "@/lib/assets";
import { useDse } from "@/lib/useDse";
import { useT } from "@/lib/i18n";

/*
 * The page itself stays a server component so it keeps its metadata; the
 * content moved here because reading the language needs a hook, and a route
 * that exports `metadata` cannot be a client component.
 */
/*
 * Written for the person using it, not the person who built it.
 *
 * The earlier version explained precompiles, WAD multipliers and venue
 * aggregation — all true, and none of it what a first-time investor needs to
 * decide whether to trust this with their money. The machinery is still one
 * tap away in "Check it yourself"; the steps say what happens to *you*.
 */
const STEPS = [
  {
    n: "01",
    t: "Open an account",
    b: "Sign up with your phone number, then verify who you are with a photo of your ID and a quick selfie. It takes a few minutes, and you only do it once.",
    refs: [],
  },
  {
    n: "02",
    t: "Add shillings",
    b: "Top up from M-Pesa, Airtel Money, Tigo Pesa or any Tanzanian bank. Your balance is held in shillings, so there is no currency to convert and nothing to lose on an exchange rate.",
    refs: [],
  },
  {
    n: "03",
    t: "Buy a share",
    b: "Pick a company — CRDB, NMB or others on the Dar es Salaam Stock Exchange, or well-known US names — and choose how much to spend. You do not need to buy a whole share: TSh 2,000 buys you a piece. The purchase is done the same day.",
    refs: [],
  },
  {
    n: "04",
    t: "Your shares are held safely for you",
    b: "The real shares are held by a licensed DSE broker. Each one is matched by a digital record on a public ledger, one for one, so what CAPX holds can be checked by anyone at any time, not just taken on trust.",
    refs: [{ label: "See what is held", href: "/proof" }],
  },
  {
    n: "05",
    t: "Sell and withdraw whenever you like",
    b: "Sell some or all of your shares and the shillings are back in your balance straight away. Withdraw to your mobile money or bank account in a couple of taps.",
    refs: [],
  },
];

const FAQ = [
  {
    q: "What does it cost?",
    a: "2.5% when you buy and 2.5% when you sell — 1% of that goes to the licensed broker that holds the shares. There is no account fee and no monthly charge. Mobile money and bank transfers may carry the network's own small fee, and you always see it before you confirm.",
  },
  {
    q: "Is my share a real share?",
    a: "Yes. Every CRDB or NMB share in your account is a real share held for you by a licensed broker, and CAPX never sells more than it holds. You can see the totals on the proof page whenever you want.",
  },
  {
    q: "What happens when I sell?",
    a: "CAPX buys the shares back from you at the current price and puts the shillings, less the 2.5% fee, into your balance immediately. Those shares go back into CAPX's stock, ready for the next buyer.",
  },
  {
    q: "Where do the prices come from?",
    a: "Tanzanian shares use the Dar es Salaam Stock Exchange's own prices, updated through the trading day. US shares follow their US market price. You pay the price shown, not a hidden markup.",
  },
  {
    q: "Can I buy less than one share?",
    a: "Yes. You choose the amount in shillings and get that share of a share. It makes it possible to start small and add as you go.",
  },
  {
    q: "Who can use CAPX?",
    a: "Anyone in Tanzania with a valid ID, a phone number and a mobile money or bank account. US shares are not available to US persons. Share prices go up and down, and nothing here is investment advice.",
  },
];

export function HowItWorksView() {
  const { t } = useT();
  const dse = useDse();
  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-12 sm:px-8">
      <Reveal>
        <div className="eyebrow">{t("How it works")}</div>
        <h1 className="display mt-4 max-w-4xl text-[clamp(2.2rem,6vw,5rem)]">
          <RevealWords text={t("From shillings")} />{" "}
          <span className="contra text-[var(--muted)]">
            <RevealWords text={t("to shares.")} delay={0.12} />
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
          {t("Five steps, a few minutes, and a phone. Here is what happens at each one.")}
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
                    <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.04em]">{t(s.t)}</h2>
                    <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">{t(s.b)}</p>
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
              <div className="eyebrow">{t("Check it yourself")}</div>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
                {t("For the curious: every company on CAPX has a public address where its shares can be counted. Tap one to see it.")}
              </p>
              {/*
                * The Tanzanian shares first, and by name.
                *
                * This list was the US tokens alone, which on a page whose
                * whole argument is "CRDB is really held" left the shares
                * somebody came to check missing from the one place they
                * could check them. They are tokens CAPX issued, so their
                * addresses are as public as anything here.
                */}
              <div className="scroll-thin mt-4 max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                {dse.filter((d) => d.token).map((d) => (
                  <div key={d.symbol} className="flex items-center justify-between gap-3 text-xs">
                    <Link href={`/markets/${d.symbol.toLowerCase()}`} className="flex items-center gap-2 hover:opacity-70">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#0B7D3E]" />
                      <span className="font-medium">{d.symbol}</span>
                      <span className="text-[var(--muted)]">{d.kind === "external" ? "" : "· DSE"}</span>
                    </Link>
                    <a href={`https://basescan.org/address/${d.token}`} target="_blank" rel="noreferrer"
                      className="tnum text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
                      {d.token!.slice(0, 8)}…{d.token!.slice(-4)} ↗
                    </a>
                  </div>
                ))}
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
                {t("These records live on Base, a public network. Nobody, including CAPX, can change what they say without everyone seeing.")}
              </p>
            </div>
          </div>
        </Reveal>
      </div>

      <Reveal className="mt-20">
        <h2 className="display text-[clamp(1.8rem,4vw,3rem)]">{t("Straight answers")}</h2>
        <div className="mt-8 grid gap-px overflow-hidden rounded-3xl bg-[var(--border)] md:grid-cols-2">
          {FAQ.map((f) => (
            <div key={f.q} className="bg-[var(--bg)] p-7">
              <h3 className="font-[family-name:var(--font-display)] text-lg font-medium tracking-[-0.03em]">{t(f.q)}</h3>
              <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--muted)]">{t(f.a)}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="mt-16">
        <div className="flex flex-wrap gap-3">
          <Link href="/markets" className="rounded-full bg-[var(--fg)] px-6 py-3.5 text-sm font-medium text-[var(--bg)] transition-transform hover:scale-[1.03]">
            {t("Explore markets")} →
          </Link>
          <a href="/proof"
            className="rounded-full border hairline px-6 py-3.5 text-sm font-medium transition-colors hover:surface">
            {t("See what is held")} ↗
          </a>
        </div>
      </Reveal>
    </div>
  );
}
