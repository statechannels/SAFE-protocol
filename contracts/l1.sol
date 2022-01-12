// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

struct TokenPair {
    address l1Token;
    address l2Token;
}

contract l1 is SignatureChecker {
    uint256 nextNonce = 0;
    // TODO: Eventually this should probably use a well-tested ownership library.
    address owner;
    /// Maps a L1 token address to the L2 token address.
    mapping(address => address) public l1TokenMap;

    receive() external payable {}

    constructor() {
        owner = msg.sender;
    }

    function registerTokenPairs(TokenPair[] memory pairs) public {
        require(msg.sender == owner, "Only the owner can add token pairs");
        for (uint256 i = 0; i < pairs.length; i++) {
            require(
                l1TokenMap[pairs[i].l1Token] == address(0),
                "A mapping exists for the L1 token"
            );

            l1TokenMap[pairs[i].l1Token] = pairs[i].l2Token;
        }
    }

    function claimBatch(
        L1Ticket[] calldata tickets,
        Signature calldata signature
    ) public {
        bytes32 message = keccak256(
            abi.encode(TicketsWithNonce(nextNonce, tickets))
        );

        require(
            recoverSigner(message, signature) == owner,
            "Must be signed by liquidity provider"
        );

        for (uint256 i = 0; i < tickets.length; i++) {
            IERC20 tokenContract = IERC20(l1TokenMap[tickets[i].token]);
            tokenContract.transfer(tickets[i].l1Recipient, tickets[i].value);
        }

        nextNonce = nextNonce + tickets.length;
    }
}
