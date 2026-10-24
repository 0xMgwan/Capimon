import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Partner API · CAPX",
  description: "Buy tokenised Dar es Salaam and US equities for your own customers.",
};

type Endpoint = {
  method: string; path: string; what: string;
  body?: [string, string][];
  returns?: string;
  note?: string;
};

const BASE = "https://www.capx.broker/api/partner";

const GROUPS: { title: string; blurb: string; endpoints: Endpoint[] }[] = [
  {
    title: "Markets",
    blurb: "What your customers can buy. Both boards come back in one list, each labelled with the currency it actually trades in.",
    endpoints: [
      { method: "GET", path: "/v1/markets/:symbol/history",
        what: "Price history for charting, on either board.",
        body: [["days", "optional, up to 1825. Defaults to 365."]],
        returns: "candles[] of { t, open, high, low, close } with t in seconds, plus venue, currency and source. The same series CAPX draws its own charts from, so a partner's chart and ours cannot disagree.",
        note: "The two boards differ and the response says so rather than flattening them. A DSE series is in shillings, one point per session the exchange printed. A US series is in dollars from the Chainlink feed's own rounds, and is total-return — the price already carries the token's multiplier, so a split or dividend leaves no step in the line. Read `source`: \"dse\" is live from the exchange, while \"saved\" or \"oracle\" means the exchange was unreachable and this is the last good series or the oracle's own record." },
      { method: "GET", path: "/v1/markets",
        what: "Every tradeable security, Dar es Salaam and US.",
        returns: "symbol, name, venue, currency (TZS or USD), price, logo, tradable. US entries also carry onchain_supply — a token nobody has minted cannot be routed to, whatever its price feed says." },
    ],
  },
  {
    title: "Customers",
    blurb: "Your customers become ordinary CAPX accounts carrying your id for them. You authenticate them; CAPX never issues them a password.",
    endpoints: [
      { method: "POST", path: "/v1/users", what: "Create a customer.",
        body: [
          ["email", "required. Must not already exist on CAPX — an email in use is refused, never adopted."],
          ["reference", "required. Your own id for this person. Unique within your account."],
          ["name", "optional"], ["phone", "optional"], ["country", "optional, ISO-2, defaults to yours"],
        ],
        returns: "The customer, including their CAPX id and balances.",
        note: "Idempotent. Calling again with the same reference returns the existing customer rather than a second one." },
      { method: "GET", path: "/v1/users", what: "Your customers, newest first." },
      { method: "GET", path: "/v1/users/:ref", what: "One customer, by your reference or their CAPX id." },
      { method: "GET", path: "/v1/users/:ref/positions",
        what: "What they hold, priced on each board in its own currency.",
        returns: "cash { TZS, USDC } and positions[] with qty, price and value. Nothing is converted into a single currency — a customer who bought in shillings never saw a dollar figure." },
    ],
  },
  {
    title: "Verification",
    blurb: "Buying is gated on the customer being verified. By default you file and CAPX reviews, and nothing you send sets the status. Where CAPX has examined your own onboarding and granted reliance, your attestation verifies the customer immediately — ask us about it. Either way CAPX records who attested and when, and can revoke any single customer.",
    endpoints: [
      { method: "POST", path: "/v1/users/:ref/kyc", what: "File a customer's documents for review.",
        body: [
          ["full_name", "required"], ["document_type", "required — nida, passport, licence"],
          ["document_number", "required"],
          ["document_image", "required. base64, a data: URL is fine."],
          ["selfie_image", "required. base64."],
        ],
        returns: "Without reliance: 202 and kyc_status pending. With reliance: 200, kyc_status approved, and the customer can buy immediately. The response carries `source` so you never have to guess which happened.",
        note: "Images are required when CAPX reviews, because a review needs something to look at. Under reliance they are optional — but send them if you can: the day a regulator asks CAPX to evidence an identification, holding the document is the difference between answering and asking you." },
    ],
  },
  {
    title: "Orders",
    blurb: "One endpoint, both boards. The security decides the venue; a DSE symbol prices in shillings, a US ticker in dollars.",
    endpoints: [
      { method: "POST", path: "/v1/orders", what: "Buy or sell for a customer.",
        body: [
          ["user", "required. Your reference, or their CAPX id."],
          ["security", "required. CRDB, NMB … or AAPLc, NVDAc …"],
          ["side", "buy or sell"],
          ["amount", "shillings on a buy; shares on a sell"],
          ["currency", "TZS or USDC. US board only; ignored on the DSE."],
        ],
        returns: "The settled order with qty, price, amount, currency and fee.",
        note: "Send an Idempotency-Key. These go through the same code a CAPX customer's own order does, so every refusal applies: unverified accounts cannot buy, halted markets stay halted, and inventory that is not held is not sold." },
      { method: "GET", path: "/v1/orders", what: "Your customers' orders, newest first." },
    ],
  },
  {
    title: "Dividends and corporate actions",
    blurb: "Neither board pays cash. A tokenised equity reflects a dividend by raising its multiplier, so the holder's share count grows instead. CAPX reads that and credits whoever held the claim.",
    endpoints: [
      { method: "GET", path: "/v1/users/:ref/dividends",
        what: "Corporate actions credited to one customer.",
        returns: "security, shares_credited, multiplier, created_at.",
        note: "Show your customer the shares. A 'dividend received' figure in shillings would be a number they cannot act on and did not receive." },
    ],
  },
  {
    title: "Currencies",
    blurb: "US equities trade in dollars and a USDC balance buys them directly — no conversion, no extra call. The Dar es Salaam board prices and settles in shillings and reads a shilling balance, so a customer holding only dollars must convert before they can buy CRDB.",
    endpoints: [
      { method: "POST", path: "/v1/convert", what: "Turn a customer's dollars into shillings.",
        body: [["user", "required"], ["amount_usdc", "or"], ["all", "true to convert the whole balance"]],
        returns: "The dollars spent and the shillings credited, at the rate the swap actually reported.",
        note: "One direction only. Shillings become dollars inside a US buy at the moment it needs them; offering that conversion on its own would make CAPX a currency desk." },
    ],
  },
  {
    title: "Settlement",
    blurb: "Where to send stablecoin, and in what. Read it rather than hardcoding the address — it is served live from the omnibus account, and a copy in your config is the one field where being out of date means sending money somewhere CAPX is not watching.",
    endpoints: [
      { method: "GET", path: "/v1/settlement",
        what: "The CAPX omnibus address on Base, and the tokens it accepts.",
        returns: "chain, omnibus_address, tokens[] with contract addresses and decimals, and the steps to credit a customer.",
        note: "Send only NTZS or USDC on Base. Anything else is not credited and cannot be returned automatically. omnibus_address is null if it could not be read — try again rather than falling back to a cached value." },
    ],
  },
  {
    title: "Money in and out",
    blurb: "Three ways in: a mobile money collection, a bank push, or a stablecoin transfer you have already made to the omnibus wallet. All of them land in the same omnibus as every other customer's money. There is no endpoint that credits a balance directly, and there will not be — a balance that can be written without money arriving is not a balance.",
    endpoints: [
      { method: "GET", path: "/v1/deposits", what: "Funding history, optionally filtered by ?user=." },
      { method: "POST", path: "/v1/deposits", what: "Credit a customer from a stablecoin transfer you have already sent.",
        body: [
          ["user", "required"],
          ["tx_hash", "required. The Base transaction that moved the tokens to the CAPX omnibus wallet."],
          ["token", "NTZS (default) or USDC"],
          ["buy_on_arrival", "optional { security, side?, amount?, currency? } — the order to place the moment the deposit is credited. Omit amount to spend the whole deposit."],
        ],
        returns: "202 with status pending while the block is not yet safe, then 201 / status settled once it is. The amount is read from the transaction itself.",
        note: "For partners whose customers already hold nTZS — no collection, no prompt. The amount credited is whatever the Transfer log actually carries, never the figure in your request, and the recipient must be the omnibus wallet. Nothing is credited on your word; this is read from the chain." },
      { method: "", path: "— buy_on_arrival",
        what: "Hand over the transfer and the trade in one call.",
        note: "If the block is already safe the order executes inline and the response carries it. Otherwise it is held and runs the moment the deposit is credited, and you are told over the webhook — there is no response left to report into by then. Two things to pass on to your customer: the fill is at the price when it executes, not when you submitted, which on a volatile US name is a real difference over the minute it waits; and an order that fails never costs the deposit — the money is credited and stays as their cash, with the reason on the deposit and an order.failed webhook." },
      { method: "", path: "— on waiting for safety",
        what: "Base is an L2, so mined is not final.",
        note: "A transfer is recorded on arrival and credited once the block containing it has been batched to Ethereum — the `safe` tag, about a minute behind the head. Counting confirmations would be the weaker test, since those are built by the same sequencer a reorg would replace. While it waits the deposit reads status pending and the balance is not yet spendable. The hash is claimed from the moment you submit it, so there is nothing to resend and resubmitting returns the same deposit rather than a second one." },
      { method: "POST", path: "/v1/deposits", what: "Or collect from their mobile money, or get bank details for them to push to.",
        body: [
          ["user", "required"], ["amount_tzs", "required"],
          ["phone", "mobile money number to prompt; defaults to the customer's"],
          ["method", "mobile_money (default) or bank_transfer"],
          ["payer_account_number", "required for bank_transfer — this is how the money is matched back to them"],
        ],
        returns: "202 with the deposit, its route and status. A bank transfer also returns `bank`: the account, the one-off reference and when it expires.",
        note: "Mobile money prompts the phone and settles on its own. A bank transfer takes nothing until the customer sends it — show them the reference verbatim, because that is what matches the money to them." },
      { method: "POST", path: "/v1/withdrawals", what: "Pay a customer out to mobile money or a bank.",
        body: [
          ["user", "required"], ["amount_tzs", "required"],
          ["phone", "mobile money"], ["bank_code + account_number", "bank payout"],
        ],
        returns: "status: sent, or status: queued when the float is short.",
        note: "Read the status. A queued payout is accepted and goes out automatically, oldest first — showing your customer 'sent' when the body says queued would be misreporting it." },
    ],
  },
];

function Row({ e }: { e: Endpoint }) {
  return (
    <div className="border-t hairline py-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
          e.method === "GET" ? "surface text-[var(--muted)]" : "bg-[var(--fg)] text-[var(--bg)]"}`}>
          {e.method}
        </span>
        <code className="text-[13px]">{e.path}</code>
        <span className="text-[13px] text-[var(--muted)]">— {e.what}</span>
      </div>
      {e.body && (
        <dl className="mt-3 grid gap-1.5 text-[12.5px] sm:grid-cols-[180px_1fr]">
          {e.body.map(([k, v]) => (
            <div key={k} className="contents">
              <dt><code className="text-[11.5px]">{k}</code></dt>
              <dd className="text-[var(--muted)]">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {e.returns && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">
          <span className="text-[var(--fg)]">Returns. </span>{e.returns}
        </p>
      )}
      {e.note && (
        <p className="mt-2 rounded-lg surface p-2.5 text-[12px] leading-relaxed text-[var(--muted)]">
          {e.note}
        </p>
      )}
    </div>
  );
}

export default function PartnerDocsPage() {
  return (
    <div className="mx-auto max-w-[900px] px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
      <div className="eyebrow">Partners</div>
      <h1 className="display mt-3 text-[clamp(2rem,5vw,3rem)]">Partner API.</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">
        One key, both boards. Everything below runs through exactly the same code a CAPX
        customer&apos;s own order runs through, which is why the refusals are worth reading: they
        are not partner-specific rules, they are the rules.
      </p>

      <section className="mt-10 rounded-2xl border hairline p-5">
        <h2 className="text-sm font-medium">Authentication</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
          Send your key as a bearer token on every request. Base URL{" "}
          <code className="text-[11.5px]">{BASE}</code>.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl surface p-3.5 text-[11.5px]">
{`Authorization: Bearer cpx_live_…`}
        </pre>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--muted)]">
          Keys come in two modes and the mode is in the key itself, so a live key pasted into a
          test config is obvious on sight. A <code className="text-[11px]">cpx_test_</code> key
          reads everything and creates customers; it cannot move money. Only the hash of a key is
          stored, so a lost key is rotated, never recovered.
        </p>
      </section>

      <section className="mt-5 rounded-2xl border hairline p-5">
        <h2 className="text-sm font-medium">Retries</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
          Every endpoint that moves money accepts{" "}
          <code className="text-[11.5px]">Idempotency-Key</code>. The first answer is kept and
          replayed to any repeat of the same key, with{" "}
          <code className="text-[11.5px]">Idempotent-Replay: true</code> on the response. Use a key
          per intent, not per attempt — that is what makes a dropped connection cost you a retry
          instead of your customer a second order.
        </p>
      </section>

      <section className="mt-5 rounded-2xl border hairline p-5">
        <h2 className="text-sm font-medium">Errors</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
          Failures return <code className="text-[11.5px]">{"{ ok: false, code, error }"}</code>.
          The <code className="text-[11.5px]">code</code> is stable and safe to branch on; the{" "}
          <code className="text-[11.5px]">error</code> is written for a person and may change.
          Several are worth handling by name:{" "}
          <code className="text-[11.5px]">kyc_none</code> and{" "}
          <code className="text-[11.5px]">kyc_pending</code> (the customer cannot buy yet),{" "}
          <code className="text-[11.5px]">insufficient_balance</code>,{" "}
          <code className="text-[11.5px]">insufficient_inventory</code>,{" "}
          <code className="text-[11.5px]">market_halted</code>,{" "}
          <code className="text-[11.5px]">trading_paused</code>,{" "}
          <code className="text-[11.5px]">test_mode</code>.
        </p>
      </section>

      <section className="mt-5 rounded-2xl border hairline p-5">
        <h2 className="text-sm font-medium">Webhooks</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
          Set a URL on your dashboard and we post{" "}
          <code className="text-[11.5px]">customer.created</code> and{" "}
          <code className="text-[11.5px]">order.settled</code> to it. Each delivery carries{" "}
          <code className="text-[11.5px]">capx-signature: sha256=…</code>, an HMAC of the raw body
          with your signing secret. Verify it against the raw bytes before parsing — the URL alone
          is not authentication, and anyone who learns it can post to it.
        </p>
      </section>

      {GROUPS.map((g) => (
        <section key={g.title} className="mt-12">
          <h2 className="text-lg font-medium">{g.title}</h2>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[var(--muted)]">
            {g.blurb}
          </p>
          <div className="mt-3">{g.endpoints.map((e) => <Row key={e.method + e.path} e={e} />)}</div>
        </section>
      ))}

      <p className="mt-14 border-t hairline pt-6 text-xs leading-relaxed text-[var(--muted)]">
        Questions, or ready for a live key?{" "}
        <a href="/partners#apply" className="underline underline-offset-2">Apply</a>, or open your{" "}
        <a href="/partners/dashboard" className="underline underline-offset-2">dashboard</a>.
      </p>
    </div>
  );
}
