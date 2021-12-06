// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Dead simple ERC20 token for testing purposes.
contract TestToken is ERC20 {
    constructor(uint256 initialBalance) ERC20("Basic", "BSC") {
        _mint(msg.sender, initialBalance);
    }
}
