// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {CustodyRegistry} from "../src/CustodyRegistry.sol";
import {PriceOracle} from "../src/PriceOracle.sol";

/**
 * Phase one: the registries and the price feed.
 *
 * Settlement is deployed separately because it takes the CRDBt address in its
 * constructor, and CRDBt does not exist until the B20 factory has created it.
 * Splitting the two keeps each step verifiable on its own rather than wiring an
 * address that was guessed ahead of time.
 *
 * nTZS lives on Base mainnet and nowhere else, so that is where settlement can
 * be real. A stand-in token on a test chain would mostly prove the stand-in
 * works.
 *
 *   forge script script/Deploy.s.sol --rpc-url $BASE_MAINNET_RPC --broadcast
 */
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("ISSUER_PRIVATE_KEY");
        address issuer = vm.addr(pk);
        console.log("issuer ", issuer);
        console.log("chainid", block.chainid);

        vm.startBroadcast(pk);
        InvestorRegistry investors = new InvestorRegistry(issuer);
        CustodyRegistry custody = new CustodyRegistry(issuer);
        // An hour: long enough that a manual desk is not forever chasing it,
        // short enough that a forgotten feed halts trading rather than quietly
        // pricing against yesterday.
        PriceOracle oracle = new PriceOracle(issuer, 1 hours);
        vm.stopBroadcast();

        console.log("InvestorRegistry", address(investors));
        console.log("CustodyRegistry ", address(custody));
        console.log("PriceOracle     ", address(oracle));
    }
}
