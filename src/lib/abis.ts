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

