# CAPX

Capital markets, onchain. CAPX is a non-custodial interface to **B20 tokenized
equities on Base** — thirteen public companies issued as native B20 tokens,
marked continuously by Chainlink total-return feeds.

Everything on the site is a live read against Base mainnet. There is no seed
data, no mock feed and no placeholder chart.

## What is actually live

| Surface | Source |
| --- | --- |
| Prices | Chainlink total-return feeds on Base (`latestRoundData`) |
| Charts | Real Chainlink round history walked back through `getRoundData` — every point is an onchain print |
| Supply & onchain value | B20 `totalSupply` × `multiplier`, valued at the live mark |
| Multiplier | B20 `multiplier()`, WAD-scaled, applied wherever a share count is shown |
| Token artwork | Decoded from the B20 `contractURI` (ERC-7572) |
| Portfolio | `scaledBalanceOf` per asset + USDC + ETH for the connected (or watched) wallet |
| Trade quotes | Uniswap v3 `QuoterV2` simulated on Base — a real executable price, or an honest "no liquidity" |
| Swaps | Calldata built server-side against the live route, signed and sent by the user's own wallet |
| Quick buy | Pick a USDC size and a company on the landing page; hands `?side=&amount=` to the asset page |

### Liquidity: routing, not a single pool

Nine of the thirteen assets have **no minted supply on Base**, so there is no
secondary market to route through — the UI marks them *Mint only* and points at
issuer mint/redeem. The four with supply (AAPL, GOOGL, META, NVDA) trade today
at roughly the oracle mark.

Liquidity does **not** live where a naive integration would look. It sits mostly
on **Aerodrome concentrated-liquidity** pools, with some routes crossing Uniswap
v4 and PancakeSwap v3. Uniswap v3 — the obvious first place to check — holds
either nothing or dust: GOOGLc has a v3 pool that will quote an *executable*
fill about 98% away from the mark. Reading one venue produces confidently wrong
answers, so CAPX aggregates and then checks the result against Chainlink:

| Distance from oracle mark | Behaviour |
| --- | --- |
| under 1% | trades normally |
| 1–5% | trades, warning shown |
| 5–15% | blocked behind an explicit acknowledgement |
| over 15% | refused; issuer mint/redeem only |

Both `/api/quote` and `/api/swap` grade independently, so a stale render cannot
push an unsafe order through.

**Fallback.** If the aggregator is unreachable, both endpoints quote and build
directly against the deepest Aerodrome Slipstream pool
(factory `0xf8f2eB49…`, quoter `0x514c8B5f…`, router `0x698Cb2b6…`, pools keyed
by tick spacing rather than fee). The fill is real and executable, just single-hop
rather than split — the UI says so rather than passing it off as the same quote.

## Run it

```bash
npm install && npm run dev
```

Opens on `http://localhost:3000`. No API keys required — it defaults to the
public Base RPC. Copy `.env.example` to `.env.local` and set a dedicated RPC
before deploying; the public endpoint is rate-limited.

## Routes

- `/` — landing page, live tickers, quick buy and onchain totals
- `/markets` — all thirteen assets, sortable, searchable, live sparklines
- `/markets/[ticker]` — chart over onchain rounds, contract references, trade panel
- `/portfolio` — connected wallet, or `?address=0x…` to watch any wallet read-only
- `/how-it-works` — the B20 mechanics CAPX depends on, with links to verify each claim

## API

All routes return live data and are safe to call directly.

- `GET /api/markets` — every asset with price, change, supply, TVL and round history
- `GET /api/quote?symbol=NVDA&side=buy&amount=100` — aggregated executable fill, graded against the oracle
- `GET /api/venues` — which assets are routable right now, on which venues, at what spread
- `POST /api/swap` — calldata for the user's wallet to sign
- `GET /api/portfolio?address=0x…` — positions valued at the live mark
- `GET /api/token?symbol=NVDA` — decoded B20 contract metadata

## Wallets

Coinbase Wallet, MetaMask and Phantom. Coinbase runs through its own SDK so it
also covers Smart Wallet with nothing installed; MetaMask and Phantom connect
via their injected providers and are probed before being offered — an undetected
wallet shows an install link instead of a dead button. Brand marks are inline
SVG, so they need no network request.

## A note on the "Built on" strip

Base, Chainlink, Coinbase, USDC, Uniswap and OP Stack appear on the landing page
with the role each one plays in the architecture. They are dependencies, not
partners or sponsors — there are no commercial relationships behind any of those
names.

## Mobile

Built to be used on a phone, not merely to survive one. Tables become card
lists below `md` so nothing scrolls sideways, a fixed bottom tab bar replaces
the hamburger, `viewport-fit=cover` plus `env(safe-area-inset-*)` handles the
notch and home indicator, and the chart shortens on small screens. Pinch zoom is
deliberately left enabled for accessibility.

Light is the default theme; dark is opt-in and remembered in `localStorage`.

## Design

Typography stands in for Ondo's licensed stack with open equivalents:
**Outfit** (display), **Figtree** (UI), **Newsreader** (editorial serif),
**JetBrains Mono** (tabular market data). Motion is `motion/react`, and every
reveal has a timer failsafe so content can never be left invisible by an
animation that did not run.

## Caching

Round history costs ~1,500 `eth_call`s per full refresh, so it is cached
separately from prices with a 90s TTL and stale-while-revalidate. Prices refresh
on a 6s TTL behind a single in-flight request; browsers poll every 10s. Cold
fetch is ~7s, warm responses are sub-20ms.

## Scope

CAPX is not a broker-dealer, exchange, or investment adviser, and nothing it
displays is investment advice. Tokenized equities are not available to US
persons. One B20 token is not permanently one share — redemption applies the
current onchain multiplier. Mint and redeem are performed by the issuer under
KYC; secondary transfers are permissionless subject to onchain policy.

Reference: [Tokenized stocks on Base](https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base)
· [B20 specification](https://docs.base.org/base-chain/specs/upgrades/beryl/b20/specification)
