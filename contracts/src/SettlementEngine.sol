// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IInvestorRegistry {
    function isAuthorized(address investor) external view returns (bool);
}

interface IPriceOracle {
    function getPrice(string calldata symbol) external view returns (uint256 price, uint64 updatedAt, string memory source);
}

/**
 * Delivery versus payment, in one transaction.
 *
 * This is the whole point of putting a Tanzanian security onchain. Today a DSE
 * trade settles days later, and for those days one side is exposed to the other
 * failing to deliver. Here the shares and the shillings move in the same call:
 * either both legs succeed or the transaction reverts and neither happened.
 * There is no window in which one party has paid and the other has not.
 *
 * The engine never holds anyone's assets. It moves them directly between the
 * two parties using allowances, so a bug here cannot strand a balance — there
 * is nothing sitting in it to strand.
 */
contract SettlementEngine {
    IERC20Min public immutable security;      // CRDBt
    IERC20Min public immutable cash;          // nTZS
    IInvestorRegistry public immutable investors;
    IPriceOracle public immutable oracle;
    string public symbol;                     // oracle key, e.g. "CRDB"

    address public admin;
    bool public paused;

    /// Tolerance between the agreed price and the oracle, in basis points.
    uint16 public maxDeviationBps = 200;

    event Settled(
        address indexed buyer, address indexed seller, uint256 quantity,
        uint256 pricePerShare, uint256 cashAmount, uint64 settledAt
    );
    event PausedSet(bool paused);
    event MaxDeviationSet(uint16 bps);
    event AdminTransferred(address indexed from, address indexed to);

    error NotAdmin();
    error ZeroAddress();
    error TradingPaused();
    error BuyerNotApproved(address buyer);
    error SellerNotApproved(address seller);
    error ZeroQuantity();
    error PriceOutOfBand(uint256 agreed, uint256 refPrice);
    error CashTransferFailed();
    error SecurityTransferFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address admin_, address security_, address cash_,
        address investors_, address oracle_, string memory symbol_
    ) {
        if (admin_ == address(0) || security_ == address(0) || cash_ == address(0)
            || investors_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        admin = admin_;
        security = IERC20Min(security_);
        cash = IERC20Min(cash_);
        investors = IInvestorRegistry(investors_);
        oracle = IPriceOracle(oracle_);
        symbol = symbol_;
    }

    /**
     * Settles one trade between a buyer and a seller.
     *
     * Both sides must have approved this contract first: the buyer for the
     * cash, the seller for the shares. The price is agreed off-chain but is
     * checked against the oracle, so a settlement cannot be pushed through at a
     * price unrelated to the market — the oracle mark is what protects the party
     * who is not watching.
     */
    function settle(
        address buyer,
        address seller,
        uint256 quantity,        // in the security's smallest unit
        uint256 pricePerShare    // cash smallest-unit per WHOLE share
    ) external returns (uint256 cashAmount) {
        if (paused) revert TradingPaused();
        if (quantity == 0) revert ZeroQuantity();

        // A regulated security may only move between known holders (Rule 4).
        if (!investors.isAuthorized(buyer)) revert BuyerNotApproved(buyer);
        if (!investors.isAuthorized(seller)) revert SellerNotApproved(seller);

        // Reverts if the feed is stale, so a trade cannot settle against a mark
        // nobody is standing behind (Rules 7 and 8).
        (uint256 refPrice,,) = oracle.getPrice(symbol);
        uint256 diff = pricePerShare > refPrice ? pricePerShare - refPrice : refPrice - pricePerShare;
        if (refPrice == 0 || (diff * 10_000) / refPrice > maxDeviationBps) {
            revert PriceOutOfBand(pricePerShare, refPrice);
        }

        // Whole shares carry the security's own decimals, so the cash owed is
        // the price per share scaled back down by them.
        cashAmount = (quantity * pricePerShare) / (10 ** security.decimals());

        /*
         * Both legs, or neither. A failed transfer reverts the whole call, so
         * there is no state in which the buyer has paid and the shares have not
         * moved — which is the exposure T+2 settlement exists to manage and
         * this removes outright.
         */
        if (!cash.transferFrom(buyer, seller, cashAmount)) revert CashTransferFailed();
        if (!security.transferFrom(seller, buyer, quantity)) revert SecurityTransferFailed();

        emit Settled(buyer, seller, quantity, pricePerShare, cashAmount, uint64(block.timestamp));
    }

    function setPaused(bool value) external onlyAdmin {
        paused = value;
        emit PausedSet(value);
    }

    function setMaxDeviationBps(uint16 bps) external onlyAdmin {
        maxDeviationBps = bps;
        emit MaxDeviationSet(bps);
    }

    function transferAdmin(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, to);
        admin = to;
    }
}
