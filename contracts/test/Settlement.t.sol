// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {CustodyRegistry} from "../src/CustodyRegistry.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {SettlementEngine} from "../src/SettlementEngine.sol";

/// Minimal ERC-20 standing in for CRDBt and nTZS while we are on a test chain.
contract MockToken {
    string public name;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, uint8 d) { name = n; decimals = d; }

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a, "allowance");
        require(balanceOf[f] >= a, "balance");
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a;
        return true;
    }
}

contract SettlementTest is Test {
    InvestorRegistry investors;
    CustodyRegistry custody;
    PriceOracle oracle;
    SettlementEngine engine;
    MockToken crdbt;   // 2 decimals — fractional shares to a hundredth
    MockToken ntzs;    // 6 decimals

    address admin = address(0xA11CE);
    address alice = address(0xA1);
    address bob   = address(0xB0);

    // 2,500 TZS per share, in nTZS smallest units.
    uint256 constant PRICE = 2_500 * 1e6;

    function setUp() public {
        vm.warp(1_757_000_000);
        vm.startPrank(admin);
        investors = new InvestorRegistry(admin);
        custody   = new CustodyRegistry(admin);
        oracle    = new PriceOracle(admin, 1 hours);
        crdbt = new MockToken("CRDBt", 2);
        ntzs  = new MockToken("nTZS", 6);
        engine = new SettlementEngine(admin, address(crdbt), address(ntzs), address(investors), address(oracle), "CRDB");

        investors.approveInvestor(alice, "KYC-001");
        investors.approveInvestor(bob, "KYC-002");
        oracle.setPrice("CRDB", PRICE, "DSE Demo Feed");
        custody.attestCustody("CRDB", "Stanbic Bank Tanzania", 100, 100, uint64(block.timestamp + 30 days), "STANBIC-001");
        vm.stopPrank();

        crdbt.mint(bob, 50 * 1e2);          // Bob holds 50 shares
        ntzs.mint(alice, 100_000 * 1e6);    // Alice holds 100,000 TZS
    }

    /// The headline: 10 shares against 25,000 TZS, both legs in one call.
    function test_atomicDvP() public {
        vm.prank(alice); ntzs.approve(address(engine), type(uint256).max);
        vm.prank(bob);   crdbt.approve(address(engine), type(uint256).max);

        uint256 cashPaid = engine.settle(alice, bob, 10 * 1e2, PRICE);

        assertEq(cashPaid, 25_000 * 1e6, "25,000 TZS for 10 shares at 2,500");
        assertEq(crdbt.balanceOf(alice), 10 * 1e2, "Alice receives 10 CRDBt");
        assertEq(crdbt.balanceOf(bob), 40 * 1e2, "Bob is left with 40");
        assertEq(ntzs.balanceOf(alice), 75_000 * 1e6, "Alice pays 25,000");
        assertEq(ntzs.balanceOf(bob), 25_000 * 1e6, "Bob is paid 25,000");
    }

    /// Rule 5: if either leg cannot settle, neither does.
    function test_revertsWholeTradeWhenBuyerCannotPay() public {
        vm.prank(alice); ntzs.approve(address(engine), 1);      // not enough allowance
        vm.prank(bob);   crdbt.approve(address(engine), type(uint256).max);

        vm.expectRevert();
        engine.settle(alice, bob, 10 * 1e2, PRICE);

        assertEq(crdbt.balanceOf(bob), 50 * 1e2, "Bob still holds every share");
        assertEq(ntzs.balanceOf(alice), 100_000 * 1e6, "Alice still holds every shilling");
    }

    /// Rule 4: a regulated security only moves between known holders.
    function test_rejectsUnapprovedBuyer() public {
        address stranger = address(0xDEAD);
        vm.prank(bob); crdbt.approve(address(engine), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.BuyerNotApproved.selector, stranger));
        engine.settle(stranger, bob, 1e2, PRICE);
    }

    /// Rule 4 again: revoking takes effect immediately.
    function test_rejectsFrozenSeller() public {
        vm.prank(admin); investors.setFrozen(bob, true);
        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.SellerNotApproved.selector, bob));
        engine.settle(alice, bob, 1e2, PRICE);
    }

    /// Rule 8: a stale mark cannot price a trade.
    function test_rejectsStaleOracle() public {
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert();
        engine.settle(alice, bob, 1e2, PRICE);
    }

    /// A price far from the oracle is refused, whoever agreed it.
    function test_rejectsPriceOutOfBand() public {
        vm.expectRevert();
        engine.settle(alice, bob, 1e2, PRICE * 2);
    }

    /// Rule 6: a paused security does not trade.
    function test_rejectsWhenPaused() public {
        vm.prank(admin); engine.setPaused(true);
        vm.expectRevert(SettlementEngine.TradingPaused.selector);
        engine.settle(alice, bob, 1e2, PRICE);
    }

    /// Rule 9: custody evidence goes stale, and stale evidence backs nothing.
    function test_custodyExpires() public {
        assertEq(custody.verifiedQuantity("CRDB"), 100, "fresh attestation backs 100 shares");
        vm.warp(block.timestamp + 31 days);
        assertEq(custody.verifiedQuantity("CRDB"), 0, "expired attestation backs nothing");
        assertFalse(custody.isFresh("CRDB"));
    }

    /// Rule 1's foundation: you cannot earmark more than is held.
    function test_cannotLockMoreThanHeld() public {
        vm.prank(admin);
        vm.expectRevert(CustodyRegistry.LockedExceedsQuantity.selector);
        custody.attestCustody("CRDB", "Stanbic", 100, 101, uint64(block.timestamp + 1 days), "BAD");
    }
}
