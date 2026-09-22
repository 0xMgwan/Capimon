#!/usr/bin/env bash
#
# Creates a tokenised DSE share on Base, and gives the issuer the mint role.
#
# The general form of create-crdbt.sh, which stays as the record of how CRDBt
# was made. Same reasons for being a shell script: B20 tokens come from a
# precompile that forge's local EVM does not implement, so every call goes to
# a real node.
#
# The token's address is derived from (variant, issuer, keccak(symbol)), so it
# is known before anything is sent and a second run is refused by the factory.
#
# Usage (from contracts/, with .env holding ISSUER_PRIVATE_KEY and BASE_MAINNET_RPC):
#   source .env
#   ./script/create-b20.sh "NMB Bank Plc" NMBt              # dry run
#   ./script/create-b20.sh "NMB Bank Plc" NMBt --broadcast  # create it
#   ./script/create-b20.sh "NMB Bank Plc" NMBt --grant-mint # then allow minting
set -euo pipefail

NAME="${1:?name, e.g. \"NMB Bank Plc\"}"
SYMBOL="${2:?symbol, e.g. NMBt}"
MODE="${3:-}"

FACTORY=0xB20f000000000000000000000000000000000000
VARIANT_ASSET=0
# One token is one share at any precision; eight matches CRDBt.
DECIMALS=8
# keccak256("MINT_ROLE") — the role CRDBt needed granted before its first mint.
MINT_ROLE=0x154c00819833dac601ee5ddded6fda79d9d8b506b911b3dbd54cdb95fe6c3686

ISSUER=$(cast wallet address --private-key "$ISSUER_PRIVATE_KEY")
SALT=$(cast keccak "$SYMBOL")
# The version is a field of the struct, not a prefix (see create-crdbt.sh).
PARAMS=$(cast abi-encode "f((uint8,string,string,address,uint8))" \
  "(1,\"$NAME\",\"$SYMBOL\",$ISSUER,$DECIMALS)")
TOKEN=$(cast call "$FACTORY" "getB20Address(uint8,address,bytes32)(address)" \
  "$VARIANT_ASSET" "$ISSUER" "$SALT" --rpc-url "$BASE_MAINNET_RPC")

echo "issuer  $ISSUER"
echo "token   $TOKEN   ($SYMBOL, $DECIMALS dp)"
echo "exists? $(cast call "$FACTORY" 'isB20Initialized(address)(bool)' "$TOKEN" --rpc-url "$BASE_MAINNET_RPC")"

ARGS=("$FACTORY" "createB20(uint8,bytes32,bytes,bytes[])(address)" "$VARIANT_ASSET" "$SALT" "$PARAMS" "[]")

case "$MODE" in
  --broadcast)
    cast send "${ARGS[@]}" --private-key "$ISSUER_PRIVATE_KEY" --rpc-url "$BASE_MAINNET_RPC"
    echo "created. next: $0 \"$NAME\" $SYMBOL --grant-mint, then register $TOKEN on the desk." ;;
  --grant-mint)
    cast send "$TOKEN" "grantRole(bytes32,address)" "$MINT_ROLE" "$ISSUER" \
      --private-key "$ISSUER_PRIVATE_KEY" --rpc-url "$BASE_MAINNET_RPC"
    echo "has mint role? $(cast call "$TOKEN" 'hasRole(bytes32,address)(bool)' "$MINT_ROLE" "$ISSUER" --rpc-url "$BASE_MAINNET_RPC")" ;;
  *)
    echo "dry run $(cast call "${ARGS[@]}" --from "$ISSUER" --rpc-url "$BASE_MAINNET_RPC")"
    echo "(pass --broadcast to create it)" ;;
esac
