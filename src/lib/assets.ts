export type AssetMeta = {
  /** B20 token symbol on Base, e.g. AAPLc */
  symbol: string;
  /** Underlying equity ticker, e.g. AAPL */
  ticker: string;
  name: string;
  /** B20 precompile address on Base mainnet */
  token: `0x${string}`;
  /** Chainlink total-return price feed on Base mainnet */
  feed: `0x${string}`;
  sector: string;
  exchange: string;
  /** Brand accent used for charts and cards */
  color: string;
  blurb: string;
};

/**
 * The full set of B20 tokenized equities live on Base mainnet.
 * Addresses from docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base
 */
export const ASSETS: AssetMeta[] = [
  {
    symbol: "AAPLc", ticker: "AAPL", name: "Apple Inc.",
    token: "0xb200000000000000000000C2e324d24d7eEcd1fb",
    feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
    sector: "Technology", exchange: "NASDAQ", color: "#8b8b90",
    blurb: "Consumer hardware, silicon and services — the largest company by market capitalisation.",
  },
  {
    symbol: "AMZNc", ticker: "AMZN", name: "Amazon.com Inc.",
    token: "0xb200000000000000000000d9192b6B456483C2E8",
    feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
    sector: "Consumer Discretionary", exchange: "NASDAQ", color: "#ff9900",
    blurb: "Global e-commerce and the cloud infrastructure layer beneath much of the internet.",
  },
  {
    symbol: "COINc", ticker: "COIN", name: "Coinbase Global Inc.",
    token: "0xb200000000000000000000c85a31389D71F3ecfb",
    feed: "0x408e44f504A7371a345F03a73dDC96A4b48e8aa7",
    sector: "Financials", exchange: "NASDAQ", color: "#0052ff",
    blurb: "The listed crypto exchange and the issuer standing behind these B20 equity tokens.",
  },
  {
    symbol: "CRCLc", ticker: "CRCL", name: "Circle Internet Group Inc.",
    token: "0xB20000000000000000000019f6E7C675b73C2e4D",
    feed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33",
    sector: "Financials", exchange: "NYSE", color: "#3fb950",
    blurb: "Issuer of USDC, the settlement asset for most tokenized markets.",
  },
  {
    symbol: "GOOGLc", ticker: "GOOGL", name: "Alphabet Inc.",
    token: "0xb2000000000000000000002D0BA3164cc74f58B7",
    feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
    sector: "Communication Services", exchange: "NASDAQ", color: "#4285f4",
    blurb: "Search, advertising, YouTube and the DeepMind research stack.",
  },
  {
    symbol: "INTCc", ticker: "INTC", name: "Intel Corporation",
    token: "0xB2000000000000000000004AFF16039bA04bdFBc",
    feed: "0xAB657C39bac0D5886250D70849e2E3E008F2EECB",
    sector: "Technology", exchange: "NASDAQ", color: "#0071c5",
    blurb: "Integrated device manufacturer rebuilding a domestic leading-edge foundry.",
  },
  {
    symbol: "METAc", ticker: "META", name: "Meta Platforms Inc.",
    token: "0xb2000000000000000000008bC8786B856E61707C",
    feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
    sector: "Communication Services", exchange: "NASDAQ", color: "#0866ff",
    blurb: "Social networking at global scale, funding an open-weights AI research programme.",
  },
  {
    symbol: "MSFTc", ticker: "MSFT", name: "Microsoft Corporation",
    token: "0xB200000000000000000000Ab99cFa739E253872B",
    feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
    sector: "Technology", exchange: "NASDAQ", color: "#00a4ef",
    blurb: "Enterprise software, Azure, and the largest commercial AI deployment surface.",
  },
  {
    symbol: "MSTRc", ticker: "MSTR", name: "MicroStrategy Inc.",
    token: "0xb2000000000000000000004884b426556b92883d",
    feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
    sector: "Technology", exchange: "NASDAQ", color: "#f7931a",
    blurb: "Analytics software wrapped around the largest corporate bitcoin treasury.",
  },
  {
    symbol: "NVDAc", ticker: "NVDA", name: "NVIDIA Corporation",
    token: "0xb20000000000000000000078ee7ce2fE4908108C",
    feed: "0x04689a41629776563E6822F76f2e57D148d28513",
    sector: "Technology", exchange: "NASDAQ", color: "#76b900",
    blurb: "Accelerated computing — the GPUs and CUDA stack underneath the AI build-out.",
  },
  {
    symbol: "SNDKc", ticker: "SNDK", name: "SanDisk Corporation",
    token: "0xb200000000000000000000397293Cb8cda9a10c5",
    feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",
    sector: "Technology", exchange: "NASDAQ", color: "#e30613",
    blurb: "NAND flash memory and storage, spun out of Western Digital.",
  },
  {
    symbol: "SPCXc", ticker: "SPCX", name: "SpaceX",
    token: "0xb2000000000000000000007b9fcbd005511aCBd5",
    feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68",
    sector: "Industrials", exchange: "Private", color: "#005288",
    blurb: "Launch, Starship and Starlink — private-market exposure, tokenized.",
  },
  {
    symbol: "TSLAc", ticker: "TSLA", name: "Tesla Inc.",
    token: "0xb2000000000000000000001e800a7f5189430cD0",
    feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
    sector: "Consumer Discretionary", exchange: "NASDAQ", color: "#e82127",
    blurb: "Electric vehicles, energy storage and an autonomy programme in the field.",
  },
];

export const BY_SYMBOL: Record<string, AssetMeta> = Object.fromEntries(
  ASSETS.flatMap((a) => [
    [a.symbol.toLowerCase(), a],
    [a.ticker.toLowerCase(), a],
  ]),
);

/** Onchain registry of every B20 asset, per the Base docs. */
export const B20_REGISTRY = "0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD" as const;
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/**
 * Aerodrome Slipstream (concentrated liquidity) on Base — where B20 equity
 * liquidity actually sits. Used as the direct fallback when the aggregator is
 * unavailable. Resolved from the live NVDAc/USDC pool's own `factory()`.
 */
export const AERO_CL_FACTORY = "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef" as const;
export const AERO_CL_QUOTER = "0x514c8B5f54112481E28028F1166Bd78501089259" as const;
export const AERO_CL_ROUTER = "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F" as const;
/** Slipstream keys pools by tick spacing rather than fee. */
export const AERO_TICK_SPACINGS = [1, 10, 50, 100, 200, 2000] as const;

/**
 * nTZS on Base mainnet — the settlement currency for Tanzanian securities.
 *
 * Eighteen decimals, not six. USDC's six are the exception rather than the
 * rule, and assuming them here would misprice every trade by twelve orders of
 * magnitude, so any figure quoted to the settlement contract or the oracle is
 * in these units.
 */
export const NTZS_BASE = "0xF476BA983DE2F1AD532380630e2CF1D1b8b10688" as const;
export const NTZS_DECIMALS = 18;

/**
 * The securities layer, live on Base mainnet.
 *
 * Deployed 15 Sep 2026 by 0xc7cC8B31…6104e, which is the admin on all three.
 * Recorded here rather than in env vars because these are public addresses and
 * a wrong one is a silent misread rather than a missing-config error.
 */
export const SECURITIES_CONTRACTS = {
  chainId: 8453,
  investorRegistry: "0x7ff9a98b0769647213e5599ddc805317b1b402fa",
  custodyRegistry: "0x6aaabcd0083e0ee91deeb6a6bb06414cceb97901",
  priceOracle: "0x400110946852e0c2c12b6bfc26e0a0909904e889",
  settlementEngine: "0xb01f2b1a2c78ec9bc74616fe0359a7fd22c6d3b7",
} as const;

/**
 * CRDBt — one token, one CRDB Bank Plc share.
 *
 * A B20 asset token created through the factory precompile, so there is no
 * deployed bytecode to audit: the behaviour is the node's. The address is
 * derived from the issuer and a salt fixed to the symbol, which is why it
 * cannot be re-created or moved.
 *
 * The eight decimals are divisibility, not value — a holder of 0.5 CRDBt owns
 * half a share. Custody is counted in whole shares, so every comparison between
 * the two crosses a unit boundary; convert there rather than letting a share
 * count and a base-unit count drift into each other.
 */
export const CRDBT = "0xb200000000000000000000dffcb628b299b8e60f" as const;
export const CRDBT_DECIMALS = 8;
/** The custody registry's key for the same asset, which counts whole shares. */
export const CRDBT_SECURITY = "CRDB" as const;
