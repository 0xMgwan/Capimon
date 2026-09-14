// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * What a custodian says it is holding, and until when.
 *
 * This is the contract the whole model rests on: a token may only exist against
 * shares somebody has confirmed they hold. An attestation therefore carries an
 * expiry — a custody statement from six months ago is not evidence that the
 * shares are there today, and treating it as such is how a tokenised security
 * quietly stops being backed.
 *
 * The signature field is unused in the manual mode but present in the struct,
 * so a custodian that later signs its attestations needs no migration.
 */
contract CustodyRegistry {
    struct Attestation {
        string custodian;
        uint256 quantity;   // shares confirmed held
        uint256 locked;     // earmarked against tokenisation
        uint64 issuedAt;
        uint64 expiresAt;
        string docRef;   // the custodian's own document id
        bool active;
    }

    address public admin;
    mapping(bytes32 => Attestation) private _attestations; // keccak(security) => latest

    event AdminTransferred(address indexed from, address indexed to);
    event CustodyAttested(
        string security, string custodian, uint256 quantity, uint256 locked,
        uint64 expiresAt, string docRef
    );
    event CustodyRevoked(string security);

    error NotAdmin();
    error ZeroAddress();
    error LockedExceedsQuantity();
    error ExpiryInPast();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
    }

    function key(string memory security) public pure returns (bytes32) {
        return keccak256(bytes(security));
    }

    function attestCustody(
        string calldata security,
        string calldata custodian,
        uint256 quantity,
        uint256 locked,
        uint64 expiresAt,
        string calldata docRef
    ) external onlyAdmin {
        // Cannot earmark more than is held, and cannot file a statement that is
        // already out of date.
        if (locked > quantity) revert LockedExceedsQuantity();
        if (expiresAt <= block.timestamp) revert ExpiryInPast();

        _attestations[key(security)] = Attestation({
            custodian: custodian,
            quantity: quantity,
            locked: locked,
            issuedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            docRef: docRef,
            active: true
        });
        emit CustodyAttested(security, custodian, quantity, locked, expiresAt, docRef);
    }

    function revokeCustody(string calldata security) external onlyAdmin {
        _attestations[key(security)].active = false;
        emit CustodyRevoked(security);
    }

    function getCustodyPosition(string calldata security) external view returns (Attestation memory) {
        return _attestations[key(security)];
    }

    /// Shares that may back tokens right now. Zero once the statement expires.
    function verifiedQuantity(string calldata security) external view returns (uint256) {
        Attestation storage a = _attestations[key(security)];
        if (!a.active || a.expiresAt <= block.timestamp) return 0;
        return a.locked;
    }

    function isFresh(string calldata security) external view returns (bool) {
        Attestation storage a = _attestations[key(security)];
        return a.active && a.expiresAt > block.timestamp;
    }

    function transferAdmin(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, to);
        admin = to;
    }
}
