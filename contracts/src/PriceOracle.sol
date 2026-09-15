// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * The DSE reference price, with provenance attached.
 *
 * A price with no source and no timestamp is a number someone typed. Settlement
 * decides what a share is worth, so the contract records where the figure came
 * from and when — and refuses to answer once it is too old, rather than letting
 * a stale mark price a trade (Rules 7 and 8).
 *
 * `source` is a string so the same contract serves a demo feed today and a
 * licensed DSE data feed later without a migration.
 *
 * Publishing is separated from administering. Prices have to be pushed often —
 * DSE prints every session and a mark nobody refreshes is a halt waiting to
 * happen — so the key that pushes them lives in a server and is exposed in a
 * way an issuing key must never be. The publisher can set prices and nothing
 * else: it cannot mint, cannot change the staleness window, and cannot hand
 * either power to anyone.
 */
contract PriceOracle {
    struct Quote {
        uint256 price;   // in the settlement currency's smallest unit, per whole share
        uint64 updatedAt;
        string source;
        bool active;
    }

    address public admin;
    /// May set prices, and may do nothing else.
    address public publisher;
    /// How old a quote may be before it stops being usable.
    uint64 public maxAge;

    mapping(bytes32 => Quote) private _quotes;

    event AdminTransferred(address indexed from, address indexed to);
    event PriceSet(string symbol, uint256 price, string source, uint64 updatedAt);
    event MaxAgeSet(uint64 maxAge);
    event PublisherSet(address indexed publisher);

    error NotAdmin();
    error NotPublisher();
    error ZeroAddress();
    error NoPrice();
    error StalePrice(uint64 updatedAt, uint64 maxAge);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// The admin can always publish, so a lost publisher key is not a halt.
    modifier onlyPublisher() {
        if (msg.sender != publisher && msg.sender != admin) revert NotPublisher();
        _;
    }

    constructor(address admin_, uint64 maxAge_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        maxAge = maxAge_;
    }

    function key(string memory symbol) public pure returns (bytes32) {
        return keccak256(bytes(symbol));
    }

    function setPublisher(address publisher_) external onlyAdmin {
        publisher = publisher_;
        emit PublisherSet(publisher_);
    }

    function setPrice(string calldata symbol, uint256 price, string calldata source) external onlyPublisher {
        _quotes[key(symbol)] = Quote({
            price: price,
            updatedAt: uint64(block.timestamp),
            source: source,
            active: true
        });
        emit PriceSet(symbol, price, source, uint64(block.timestamp));
    }

    function setMaxAge(uint64 maxAge_) external onlyAdmin {
        maxAge = maxAge_;
        emit MaxAgeSet(maxAge_);
    }

    /// Reverts rather than returning a stale figure: settlement must not price
    /// a trade off a mark nobody is standing behind any more.
    function getPrice(string calldata symbol) external view returns (uint256 price, uint64 updatedAt, string memory source) {
        Quote storage q = _quotes[key(symbol)];
        if (!q.active) revert NoPrice();
        if (block.timestamp > q.updatedAt + maxAge) revert StalePrice(q.updatedAt, maxAge);
        return (q.price, q.updatedAt, q.source);
    }

    /// Non-reverting read, for dashboards that want to show staleness rather
    /// than fail on it.
    function peek(string calldata symbol) external view returns (Quote memory quote, bool fresh) {
        Quote storage q = _quotes[key(symbol)];
        return (q, q.active && block.timestamp <= q.updatedAt + maxAge);
    }

    function transferAdmin(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, to);
        admin = to;
    }
}
