#!/usr/bin/env bash
#
# Creates CRDBt, the tokenised CRDB Bank Plc share, on Base.
#
# This is a shell script rather than a forge script on purpose. B20 tokens are
# minted by a precompile — Rust running inside the Base node, not a contract —
# and revm has no implementation of it, so `forge script` reverts locally with
# "call to non-contract address" no matter how the fork is configured. Every
# call here therefore goes to a real node.
#
# The token already exists at the address below. Re-running this is refused by
# the factory rather than creating a second CRDBt, because the address is
# derived from (variant, sender, salt) and the salt is fixed to the symbol.
#
#   CRDBt  0xb200000000000000000000DfFCB628b299B8E60F   (mainnet, tx 0xb355c4ff…)
#
# Usage: BASE_MAINNET_RPC=… ISSUER_PRIVATE_KEY=… ./script/create-crdbt.sh [--broadcast]
set -euo pipefail

FACTORY=0xB20f000000000000000000000000000000000000
VARIANT_ASSET=0
NAME="CRDB Bank Plc"
SYMBOL="CRDBt"
# Divisibility only — one CRDBt is one share at any precision. Eight matches the
# tokenised equities already on Base and lets someone with 2,000 shillings take
# part. The factory requires 6–18 for the asset variant.
DECIMALS=8

ISSUER=$(cast wallet address --private-key "$ISSUER_PRIVATE_KEY")
SALT=$(cast keccak "$SYMBOL")

# The version is a field of the struct, not a byte glued to the front of it.
# Encoding it as a prefix is rejected by the node's decoder ("type check failed
# for offset"), which is easy to misread as a wrong field order.
PARAMS=$(cast abi-encode \
  "f((uint8,string,string,address,uint8))" \
  "(1,\"$NAME\",\"$SYMBOL\",$ISSUER,$DECIMALS)")

PREDICTED=$(cast call "$FACTORY" "getB20Address(uint8,address,bytes32)(address)" \
  "$VARIANT_ASSET" "$ISSUER" "$SALT" --rpc-url "$BASE_MAINNET_RPC")

echo "issuer    $ISSUER"
echo "predicted $PREDICTED"
echo "exists?   $(cast call "$FACTORY" 'isB20Initialized(address)(bool)' "$PREDICTED" --rpc-url "$BASE_MAINNET_RPC")"

ARGS=("$FACTORY" "createB20(uint8,bytes32,bytes,bytes[])(address)"
      "$VARIANT_ASSET" "$SALT" "$PARAMS" "[]")

if [ "${1:-}" != "--broadcast" ]; then
  # Simulated on a real node, so the precompile is present and the params
  # encoding is genuinely checked before any gas is spent.
  echo "dry run   $(cast call "${ARGS[@]}" --from "$ISSUER" --rpc-url "$BASE_MAINNET_RPC")"
  echo "(pass --broadcast to send)"
  exit 0
fi

cast send "${ARGS[@]}" --private-key "$ISSUER_PRIVATE_KEY" --rpc-url "$BASE_MAINNET_RPC"
