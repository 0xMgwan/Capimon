import type { Metadata } from "next";
import { PartnerSignup } from "@/components/PartnerSignup";

export const metadata: Metadata = {
  title: "Partners · CAPX",
  description: "Put Dar es Salaam and US equities inside your own product, in shillings.",
};

/**
 * The partner programme, and the form to join it.
 *
 * Written for somebody deciding whether to integrate, so it leads with what
 * they would actually be reselling and is specific about the parts that are
 * usually glossed over — custody, verification, and what happens to a
 * dividend.
 */
export default function PartnersPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
      <div className="eyebrow">Partners</div>
      <h1 className="display mt-3 text-[clamp(2rem,6vw,3.4rem)] leading-[1.05]">
        Your customers, our rails.
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
        CAPX holds tokenised shares in custody, prices them from live oracles and settles in
        shillings. You can put that inside your own app — Dar es Salaam listings and US equities,
        bought in the currency your customer already holds, with one API key.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { h: "Two boards, one call",
            b: "CRDB, NMB and the rest of the DSE in shillings. Apple, NVIDIA and the tokenised US board in dollars. Same endpoint, the currency is a field — a customer holding USDC buys US equities directly, and converts once to reach the DSE." },
          { h: "Your customers stay yours",
            b: "You authenticate them. CAPX never issues them a password and has no sign-in path that goes around you. They carry your own reference, so neither side needs a mapping table." },
          { h: "The same book as everyone else",
            b: "A customer you introduce is an ordinary CAPX account. Same ledger, same custody, same solvency check against what is actually held on-chain. There is no second book to reconcile." },
          { h: "Dividends handled",
            b: "A tokenised equity reflects a dividend by raising its multiplier, so the holder's share count grows rather than their cash. CAPX reads that and credits whoever held the claim. You read it back per customer." },
          { h: "Verification is real",
            b: "You file your customer's documents through the API; CAPX reviews them. Buying is gated on approval, and nothing you can send sets that — the obligation is ours and so is the decision." },
          { h: "Funding is yours to start",
            b: "Prompt your customer's mobile money, or hand them a one-off bank reference. The rail is chosen by the same code the CAPX app uses, so there is no second path for money arriving." },
          { h: "Retries are safe",
            b: "Every money endpoint takes an Idempotency-Key and returns the original answer to a repeat. A dropped connection costs you a retry, not a double order." },
        ].map((c) => (
          <div key={c.h} className="rounded-2xl border hairline p-5">
            <h3 className="text-sm font-medium">{c.h}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{c.b}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-3xl border hairline p-5 sm:p-7">
        <h2 className="text-lg font-medium">How it goes</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-4">
          {[
            ["Apply", "Takes a few minutes. You get a test key straight away and can start building."],
            ["Build", "Read markets, create customers, file their verification — all on the test key."],
            ["Approval", "A person reads your application. Your live key arrives with it."],
            ["Go live", "Swap the key. Nothing else in your integration changes."],
          ].map(([h, b], i) => (
            <li key={h}>
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                Step {i + 1}
              </div>
              <div className="mt-1 text-sm font-medium">{h}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)]">{b}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div id="apply" className="scroll-mt-24"><PartnerSignup /></div>

        <div className="rounded-3xl border hairline p-6 sm:p-8">
          <div className="eyebrow">A buy, end to end</div>
          <pre className="mt-3 overflow-x-auto rounded-xl surface p-4 text-[11.5px] leading-relaxed">
{`# 1. your customer, carrying your own id for them
curl -X POST https://www.capx.broker/api/partner/v1/users \\
  -H "Authorization: Bearer $CAPX_KEY" \\
  -d '{"email":"asha@example.com","reference":"cust_8812",
       "name":"Asha Mwinyi","phone":"+255700000000"}'

# 2. buy 50,000 shillings of CRDB
curl -X POST https://www.capx.broker/api/partner/v1/orders \\
  -H "Authorization: Bearer $CAPX_KEY" \\
  -H "Idempotency-Key: ord_9f21" \\
  -d '{"user":"cust_8812","security":"CRDB",
       "side":"buy","amount":50000}'

# 3. or Apple, in dollars
curl -X POST https://www.capx.broker/api/partner/v1/orders \\
  -H "Authorization: Bearer $CAPX_KEY" \\
  -H "Idempotency-Key: ord_9f22" \\
  -d '{"user":"cust_8812","security":"AAPLc",
       "side":"buy","amount":25,"currency":"USDC"}'`}
          </pre>
          <a href="/partners/docs"
             className="mt-5 inline-block rounded-full border hairline px-5 py-2.5 text-sm font-medium">
            Full API reference
          </a>
        </div>
      </div>

      <p className="mt-10 text-xs leading-relaxed text-[var(--muted)]">
        CAPX is operated by NEDA Labs Limited. Tokenised US equities are issued by Coinbase and are
        available only to persons in eligible jurisdictions outside the United States; you are
        responsible for applying that restriction to your own customers. Nothing here is an offer
        of securities or investment advice.
      </p>
    </div>
  );
}
