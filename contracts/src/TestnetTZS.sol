// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * nTZS's counterpart on a test chain.
 *
 * Real nTZS exists only on Base mainnet, so a rehearsal of settlement needs
 * something with its shape — eighteen decimals, same interface — for the cash
 * leg to move against. On a testnet every token is a test token, CRDBt
 * included, so this is not a pretend asset standing in for a real one; it is
 * the testnet counterpart of one.
 *
 * The mainnet deployment passes the real nTZS address instead and never
 * touches this. Minting is open because handing a demo investor a balance is
 * the only thing it is for.
 */
contract TestnetTZS {
    string public constant name = "Testnet nTZS";
    string public constant symbol = "tnTZS";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
