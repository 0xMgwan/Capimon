// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Who is allowed to hold a regulated security token.
 *
 * A security is not a bearer asset: the issuer has to know who its holders are,
 * and must be able to stop a specific one. Keeping that in its own contract
 * means the same approvals serve every security CAPX tokenises, and revoking an
 * investor takes effect everywhere at once rather than per token.
 *
 * Modelled on B20's `isAuthorized(policyID, account)` so the same shape works
 * if a security later moves onto that standard.
 */
contract InvestorRegistry {
    address public admin;

    mapping(address => bool) public approved;
    mapping(address => bool) public frozen;

    event AdminTransferred(address indexed from, address indexed to);
    event InvestorApproved(address indexed investor, string docRef);
    event InvestorRevoked(address indexed investor);
    event InvestorFrozen(address indexed investor, bool frozen);

    error NotAdmin();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
    }

    /// Approved and not frozen. Both conditions, so a freeze is instant.
    function isAuthorized(address investor) external view returns (bool) {
        return approved[investor] && !frozen[investor];
    }

    /// `docRef` is the off-chain KYC case, so an approval is auditable.
    function approveInvestor(address investor, string calldata docRef) external onlyAdmin {
        if (investor == address(0)) revert ZeroAddress();
        approved[investor] = true;
        emit InvestorApproved(investor, docRef);
    }

    function revokeInvestor(address investor) external onlyAdmin {
        approved[investor] = false;
        emit InvestorRevoked(investor);
    }

    /**
     * Freeze rather than revoke when the block is temporary — a sanctions hit
     * under review, say. The approval survives, so lifting it does not mean
     * re-running KYC.
     */
    function setFrozen(address investor, bool value) external onlyAdmin {
        frozen[investor] = value;
        emit InvestorFrozen(investor, value);
    }

    function transferAdmin(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, to);
        admin = to;
    }
}
