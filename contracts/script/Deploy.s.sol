// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {CustodyRegistry} from "../src/CustodyRegistry.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {SettlementEngine} from "../src/SettlementEngine.sol";
import {TestnetTZS} from "../src/TestnetTZS.sol";

/**
 * Brings up the securities layer on one chain.
 *
 * The cash token is chosen by chain rather than by flag: mainnet settles in the
 * real nTZS and a testnet deploys its own counterpart. Deciding it here means a
 * mainnet run cannot be pointed at a test token by passing the wrong argument.
 *
 *   forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
 */
contract Deploy is Script {
    /// Verified onchain: symbol nTZS, 18 decimals.
    address constant NTZS_MAINNET = 0xF476BA983DE2F1AD532380630e2CF1D1b8b10688;

    function run() external {
        uint256 pk = vm.envUint("ISSUER_PRIVATE_KEY");
        address issuer = vm.addr(pk);
        console.log("issuer", issuer);
        console.log("chainid", block.chainid);

        vm.startBroadcast(pk);

        address cash;
        if (block.chainid == 8453) {
            cash = NTZS_MAINNET;
            console.log("cash: real nTZS");
        } else {
            cash = address(new TestnetTZS());
            console.log("cash: TestnetTZS (test chain)");
        }

        InvestorRegistry investors = new InvestorRegistry(issuer);
        CustodyRegistry custody = new CustodyRegistry(issuer);
        // An hour: long enough that a manual desk is not chasing it, short
        // enough that a forgotten feed stops trading rather than pricing it.
        PriceOracle oracle = new PriceOracle(issuer, 1 hours);

        vm.stopBroadcast();

        console.log("InvestorRegistry", address(investors));
        console.log("CustodyRegistry ", address(custody));
        console.log("PriceOracle     ", address(oracle));
        console.log("Cash token      ", cash);
        console.log("");
        console.log("Next: create the CRDBt B20, then deploy SettlementEngine against it.");
    }
}
