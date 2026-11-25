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
        returns: "candles[] of { t, open, high, low, close, volume } with t in seconds, plus venue, currency, source and `ranges`. The same series CAPX draws its own charts from, so a partner's chart and ours cannot disagree.",
        note: "The two boards differ and the response says so rather than flattening them. A DSE series is in shillings, one point per session the exchange printed. A US series is in dollars from the Chainlink feed's own rounds, and is total-return — the price already carries the token's multiplier, so a split or dividend leaves no step in the line. Read `source`. On the US board \"market\" is real trades from the deepest onchain pool — genuine OHLC with volume, which is what you want for candles — and \"chainlink\" is the oracle's own rounds, one price per print, where open, high, low and close are all the same number and volume is null. The oracle line is the fallback when the trade index is unreachable, so a chart degrades rather than disappearing. Worth knowing that the two disagree on purpose: the pool is where the price was made, the oracle is what CAPX prices against, and an order is bounded by the oracle. On the DSE board \"dse\" is live from the exchange, while \"saved\" or \"oracle\" means the exchange was unreachable and this is the last good series or the oracle's own record. Use the `ranges` the response carries — 1D, 1W, 1M and All — for your range selector. `days` stays free-form and any value works, but without a shared convention every integrator picks their own, and the same security then shows a different history depending on which app the customer opened." },
      { method: "GET", path: "/v1/markets",
        what: "Every tradeable security, Dar es Salaam and US.",
        returns: "symbol, name, venue, currency (TZS or USD), price, logo, tradable. US entries also carry onchain_supply — a token nobody has minted cannot be routed to, whatever its price feed says." },
    ],
  },
  {
    title: "Backing and attestation",
    blurb: "What stands behind a security, and whether everything CAPX owes is actually held. The same checks the public proof page runs and the same one that pauses trading when it fails — not a separate reassurance computed for partners, which would be worth nothing to the people asking.",
    endpoints: [
      { method: "GET", path: "/v1/markets/:symbol",
        what: "One security, with the evidence behind it.",
        returns: "The security with its token address, decimals and price, `available_to_trade`, and a `backing` block. On the US board `backing` also carries `issuer_structure`: the ADGM SPV, the custodian, the auditor and the reconciliation arrangement, taken from the prospectus rather than from marketing copy.",
        note: "The two boards are backed differently and the response says which. A DSE security is a token CAPX issued against shares a licensed broker holds and attests to — you get the custodian, what they confirm holding, how much is earmarked against tokens, the ratio, and when the attestation expires. Evidence goes stale: read `fresh` and `expires_at`, because a statement from six months ago does not say the shares are there today. A US equity is a Coinbase-issued B20 token CAPX buys and holds, so CAPX attests to nothing — the backing CAPX answers for is its own treasury balance against what its customers are owed, and both are on Base for you to check. Size orders against `available_to_trade`, never `issued` or `onchain_supply`: that is custody less what customers are already owed, less anything an open quote has reserved. For coverage, display `backing.coverage_note` verbatim and do not re-derive it from the numbers. Holding exactly what is owed is the normal state on the US board — CAPX keeps no inventory and buys each share as the order settles — so `treasury_holds` and `client_held` are equal to the last decimal most of the time, and comparing them with a strict `>` reads the healthy case as a failure. If you need a machine-readable form, `backing.status` is covered, shortfall or unknown; `covered` is null, never false, when the balance could not be read, because a node that did not answer is not a security that is unbacked and showing your customer that it is would be the worst available way to be wrong. The two boards mean different things by `available_to_trade` and conflating them cost NEDApay real orders. On the DSE board it is inventory: CAPX issues those tokens against attested custody and can only sell what exists, so it is a hard cap and you should size against it. On the US board CAPX holds no inventory at all — a buy routes to the market and acquires the shares as it settles — so it is liquidity: the largest order that still fills within 2% of the small-order price, quoted live, with `fill_source: \"market\"` beside it. Do not use onchain supply for this. It is real and it belongs to other holders, none of whom have offered to sell; NVDAc showed 41,770 outstanding while the market would fill about 1,400 before the price moved 2%. `depth` carries the whole curve if you need to size past that, and an order is refused outright only if its route is more than 15% from the oracle mark." },
      { method: "GET", path: "/v1/attestation",
        what: "Whether everything CAPX owes is held, right now.",
        returns: "status covered | shortfall | unavailable, per-security held against owed in shares, dollar totals, and where the cash sits.",
        note: "Shares are compared against shares, per security, because that is the only unit in which the question has an answer — a price move cannot leave a position unbacked, only a missing share can. `unavailable` means the check could not be run: treat it as unknown, not as a pass or a fail. When it reports a shortfall CAPX pauses buying on its own, so you do not need to gate on it, though you may want to show it." },
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
      { method: "POST", path: "/v1/users/link",
        what: "Connect to somebody who already has a CAPX account.",
        body: [
          ["email", "required. Their CAPX email."],
          ["reference", "required. Your own id for them."],
          ["action", "\"request\" (default), then \"confirm\" with their code."],
          ["code", "on confirm — the six digits CAPX emailed them."],
        ],
        returns: "202 pending_consent, then the customer once confirmed.",
        note: "Creating a customer refuses an email already on CAPX, because adopting an account because you named its address would hand you somebody else's balance. This is the consented route: CAPX emails the account holder a code and the link exists once they type it back into your app. The code goes to them, not through you. The same answer comes back whether or not an account exists, so this cannot be used to discover who banks with CAPX. A link grants access and does not move the customer to you — they keep their own account, can connect other apps, and can disconnect you from their CAPX settings without asking." },
      { method: "GET", path: "/v1/users/link", what: "Your active links." },
      { method: "DELETE", path: "/v1/users/link", what: "Hand a customer back. Either side can end a link.",
        body: [["link_id", "required"]] },
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
        returns: "Without reliance: 202 and kyc_status pending. With reliance: 200, kyc_status approved, and the customer can buy immediately. The response carries `source`, and `already_verified_by_capx` when CAPX had verified them before you — your attestation is recorded but does not replace theirs.",
        note: "Images are required when CAPX reviews, because a review needs something to look at. Under reliance they are optional — but send them if you can: the day a regulator asks CAPX to evidence an identification, holding the document is the difference between answering and asking you. This works for linked customers too: somebody who already had a CAPX account but never completed verification is verified by your attestation like anyone else. Two things it will not do to an account that predates you — it never rewrites an approval CAPX itself made, and it never clears a document number already on file that your filing did not mention." },
    ],
  },
  {
    title: "Fees",
    blurb: "Everything CAPX charges, and what it would charge for a specific order. Both read the same constants the trades are priced with, so neither can drift from what is actually taken.",
    endpoints: [
      { method: "GET", path: "/v1/quote",
        what: "What an order would cost, for a confirm screen.",
        body: [
          ["security", "required"], ["side", "buy or sell"], ["amount", "required"],
          ["currency", "TZS or USDC — US board only"],
        ],
        returns: "price, qty, amount, fee, fee_currency, fee_bps, fee_percent and net. On a buy, `amount` is what leaves the balance and `net` is what is actually invested; on a sell, `amount` is what arrives.",
        note: "Priced through the same functions that run the trade, so a preview cannot disagree with the fill. Indicative all the same: quote immediately before confirming. Prices move, and a shilling order on the US board converts at whatever rate the swap reports when it runs." },
      { method: "GET", path: "/v1/fees",
        what: "The rate card, including your own share.",
        returns: "Trading bps with how it is charged on each board, the broker/CAPX/your split, and what is charged on conversion, deposits and withdrawals — which is nothing from CAPX in all three.",
        note: "Your share comes out of CAPX's slice, not on top of the customer's fee. Conversion and payout costs are named rather than omitted: CAPX adds nothing, but the nTZS swap carries a spread and the payout rail charges per payout, and a partner who sees no line for them will tell their customer there is no cost." },
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
        returns: "The settled order with qty, price, amount, currency, venue, fee and fee_currency. The fee is what was actually taken — on the US board it is in dollars even when the order was paid for in shillings, which is why the currency is stated rather than assumed.",
        note: "Send an Idempotency-Key. These go through the same code a CAPX customer's own order does, so every refusal applies: unverified accounts cannot buy, halted markets stay halted, and inventory that is not held is not sold." },
      { method: "GET", path: "/v1/orders", what: "Your customers' orders, newest first." },
    ],
  },
  {
    title: "Transfers",
    blurb: "Moving shares between CAPX accounts. Nothing is bought or sold and nothing leaves custody — the same shares stay with the same custodian and the claim on them moves, which is why both boards work identically here.",
    endpoints: [
      { method: "POST", path: "/v1/transfers", what: "Send shares from one of your customers to another CAPX account.",
        body: [
          ["from", "required. Your reference or their CAPX id. Must be your customer."],
          ["to", "required. Your reference for one of yours, or any CAPX email or @handle."],
          ["security", "required. Either board."],
          ["qty", "required. Shares, not cash."],
          ["note", "optional, shown to the recipient."],
        ],
        returns: "The transfer, with `inherited_cost` and `cost_currency`.",
        note: "The sender must be your customer; the recipient need not be, because people send things to people rather than to customers of the same app. Both must be verified — a transfer is the one way value reaches an account without passing a deposit or a trade, so an unverified recipient would be an unchecked way in, and nothing is held pending somebody finishing signup. The recipient inherits the sender's average cost rather than the day's price: a gift is not a disposal, so the sender realises nothing and the recipient's P&L continues from where the sender's left off. Send an Idempotency-Key." },
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
        note: "Mobile money prompts the phone and settles on its own. A bank transfer takes nothing until the customer sends it, so show them the account, the exact amount and the reference verbatim. What actually matches the money back to them is `payer_account_number`, not the reference: Tanzanian bank credits arrive without the payer's narration, so a reference typed perfectly into a transfer description still may not survive the rail. Send the account they are paying from, and if you can, collect the receipt afterwards and call the claim below — that is the difference between seconds and a statement sync." },
      { method: "POST", path: "/v1/deposits/:id/claim", what: "Confirm a bank transfer with the receipt your customer was given.",
        body: [["receipt", "required — the Selcom receipt on their payment confirmation, e.g. SB1106Z92ST from a bank or 111610T7ZY from a Selcom wallet"]],
        returns: "200 with `claim: credited` or `already_credited` and the deposit's new status; 202 with `claim: not_found` when the payment has not reached us yet.",
        note: "A bank push is the one funding route nobody can watch: nothing is prompted, nothing is pulled, and the narration does not survive, so the credit is matched off a statement in minutes — or by hand when it cannot be matched at all. The receipt identifies the payment outright and the shillings mint in seconds. `not_found` is NOT a failure and never means pay again: the money has simply not landed yet, so retry in a minute. Safe to repeat. The other refusals are specific on purpose — `amount_mismatch`, `paid_before_deposit`, `receipt_used`, `receipt_unavailable` and `ambiguous` all mean a person is handling it and your customer must not send a second payment." },
      { method: "POST", path: "/v1/withdrawals", what: "Pay a customer out — shillings to mobile money or a bank, or USDC to a wallet.",
        body: [
          ["user", "required"],
          ["to_address", "a wallet on Base — send with amount_usdc or amount_tzs"],
          ["amount_usdc", "with to_address — pays USDC"],
          ["amount_tzs", "with to_address pays nTZS; with a phone or bank pays shillings"],
          ["phone", "mobile money"], ["bank_code + account_number", "bank payout"],
        ],
        returns: "For a rail payout: status sent or queued, with amount_tzs and fee_tzs — the rail's own fee, quoted per payout rather than a rate CAPX applies, and null when it did not state one. For a wallet: status sent, with to_address and either amount_usdc and tx_hash, or amount_tzs and asset NTZS.",
        note: "There are three exits and the request picks one. A phone or bank destination pays shillings through a Tanzanian rail. `to_address` pays a wallet on Base, and the amount field decides the token: `amount_usdc` sends USDC, `amount_tzs` sends nTZS — which is the one you want after a customer sells a Dar es Salaam share, since they hold nTZS everywhere else and a mobile money payout would put it through one more rail and one more fee. Send exactly one amount with an address; a bare `amount` is refused rather than guessed at, because guessing between dollars and shillings is wrong by a factor of two and a half thousand. Never send an address and a phone together — a request carrying an address and a phone is refused rather than guessed at. Rail payouts: read the status, because a queued payout is accepted and goes out automatically, oldest first, and showing your customer 'sent' when the body says queued would be misreporting it. Wallet withdrawals: they send or they refuse, there is no queue, and there is no CAPX fee — the network fee is ours. It is final once mined — there is no recall, so check the address with your customer before you call this. Send an Idempotency-Key: a retry after a timeout is keyed on it and cannot pay twice, and if you get withdrawal_uncertain the transfer was already broadcast, so do not retry — CAPX is reconciling it." },
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
          stored, so a lost key is rotated, never recovered — it is also mailed to you when it is
          issued, which is the copy to keep.
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--muted)]">
          <span className="text-[var(--fg)]">Reading costs nothing and waits for nobody. </span>
          A test key is issued the moment you ask for one, on a name and an email, and every
          endpoint on this page that only reads — markets, history with volume, backing,
          attestation, fees and quotes — answers it in full against the same data CAPX draws its
          own charts from. There is no sandbox and no sample set, because a second copy of the
          numbers would be a second thing to be wrong. Approval is what lets you move money for
          real customers; it is not what lets you look.{" "}
          <a href="/partners#apply" className="underline underline-offset-2">Get a key</a>.
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
          <code className="text-[11.5px]">customer.created</code>,{" "}
          <code className="text-[11.5px]">customer.linked</code>,{" "}
          <code className="text-[11.5px]">customer.verified</code>,{" "}
          <code className="text-[11.5px]">deposit.started</code>,{" "}
          <code className="text-[11.5px]">deposit.credited</code>,{" "}
          <code className="text-[11.5px]">deposit.reversed</code>,{" "}
          <code className="text-[11.5px]">order.settled</code>,{" "}
          <code className="text-[11.5px]">order.failed</code> and{" "}
          <code className="text-[11.5px]">shares.transferred</code> and{" "}
          <code className="text-[11.5px]">withdrawal.sent</code> to it. Each delivery carries{" "}
          <code className="text-[11.5px]">capx-signature: sha256=…</code>, an HMAC of the raw body
          with your signing secret. Verify it against the raw bytes before parsing — the URL alone
          is not authentication, and anyone who learns it can post to it.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
          <code className="text-[11.5px]">deposit.credited</code> is the one to wire up if money
          looks slow to arrive. A stablecoin transfer is announced to us while its block is still
          unsafe, so the call returns <code className="text-[11.5px]">pending</code> — and the
          credit then happens a minute or two later, with no response left to report into. Without
          the webhook the only way you learn is by polling{" "}
          <code className="text-[11.5px]">GET /v1/deposits</code>, which settles whatever is ready
          before it answers, so it is a correct way to find out and a slow way to be told.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
          A mobile money collection works the same way and for a different reason: nothing happens
          until your customer approves the prompt on their handset, so{" "}
          <code className="text-[11.5px]">POST /v1/deposits</code> can only ever answer{" "}
          <code className="text-[11.5px]">202</code>. We watch it from the moment it starts and
          post <code className="text-[11.5px]">deposit.credited</code> the moment nTZS confirms
          the payment, which is usually within seconds of them pressing accept. You do not have
          to poll for it.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
          A small deposit is credited as soon as it is mined, without waiting for the batch — the
          response carries <code className="text-[11.5px]">early: true</code> and the money is
          immediately spendable. It stays reversible for the minute or two until its block is safe,
          so if that transaction is reorged out we reverse the credit and post{" "}
          <code className="text-[11.5px]">deposit.reversed</code>. Handle that event: it is rare,
          but it is the one case where a balance you have already shown goes down.
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
        Want to try it? A{" "}
        <a href="/partners#apply" className="underline underline-offset-2">test key</a> takes two
        fields and reads everything here. Ready to move money for real customers?{" "}
        <a href="/partners#apply" className="underline underline-offset-2">Apply</a> and a person
        reads it. Already have a key — open your{" "}
        <a href="/partners/dashboard" className="underline underline-offset-2">dashboard</a>.
      </p>
    </div>
  );
}
