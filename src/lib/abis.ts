/** Chainlink AggregatorV3 proxy — total-return feeds for B20 equities on Base. */
export const aggregatorAbi = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ] },
  { type: "function", name: "getRoundData", stateMutability: "view",
    inputs: [{ name: "_roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/**
 * B20 — ERC-20 plus the asset extensions defined in the Beryl upgrade spec.
 * `multiplier` is WAD-scaled (1e18) and encodes corporate actions, so one token
 * is not permanently one share.
 */
export const b20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transferWithMemo", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }, { name: "memo", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "multiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "scaledBalanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "toScaledBalance", stateMutability: "view", inputs: [{ name: "raw", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "toRawBalance", stateMutability: "view", inputs: [{ name: "scaled", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "contractURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "supplyCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "isAuthorized", stateMutability: "view", inputs: [{ name: "policyId", type: "uint64" }, { name: "account", type: "address" }], outputs: [{ type: "bool" }] },
] as const;


/** Aerodrome Slipstream — pools are keyed by tickSpacing, not fee. */
export const aeroFactoryAbi = [
  { type: "function", name: "getPool", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "int24" }],
    outputs: [{ type: "address" }] },
] as const;

export const aeroPoolAbi = [
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
] as const;

export const aeroQuoterAbi = [
  { type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
    inputs: [{ components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "tickSpacing", type: "int24" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ], name: "params", type: "tuple" }],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ] },
] as const;

export const aeroRouterAbi = [
  { type: "function", name: "exactInputSingle", stateMutability: "payable",
    inputs: [{ components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "tickSpacing", type: "int24" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ], name: "params", type: "tuple" }],
    outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;

/**
 * Aave v4 spoke, the subset CAPX uses.
 *
 * v4 has no Pool: a spoke is the entry point and reserves are addressed by a
 * numeric id rather than by token address, so `supply` and `withdraw` take a
 * reserveId. Copied from the verified implementation behind the proxy
 * (SpokeInstance at 0x81A73c282faa932DE3B2541CEe19549f4BF13b19), not from a
 * v3 interface, because the signatures differ.
 *
 * A position is held in shares; interest accrues as the share price rises,
 * so the supplied-assets and supplied-shares totals are both needed to turn
 * a holding back into dollars.
 */
export const aaveSpokeAbi = [
  { type: "function", name: "supply", stateMutability: "nonpayable",
    inputs: [{ name: "reserveId", type: "uint256" }, { name: "amount", type: "uint256" },
             { name: "onBehalfOf", type: "address" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable",
    inputs: [{ name: "reserveId", type: "uint256" }, { name: "amount", type: "uint256" },
             { name: "onBehalfOf", type: "address" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "getUserPosition", stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ type: "tuple", components: [
      { name: "drawnShares", type: "uint120" },
      { name: "premiumShares", type: "uint120" },
      { name: "premiumOffsetRay", type: "int200" },
      { name: "suppliedShares", type: "uint120" },
      { name: "dynamicConfigKey", type: "uint32" },
    ] }] },
  { type: "function", name: "getReserveSuppliedAssets", stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getReserveSuppliedShares", stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;
