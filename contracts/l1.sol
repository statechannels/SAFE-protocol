// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

contract l1 is SignatureChecker, FundsSender {
    uint256 nextNonce = 0;

    receive() external payable {}

    function claimBatch(L1Ticket[] calldata tickets, Signature calldata signature)
        public
    {
        bytes32 message = keccak256(
            abi.encode(TicketsWithNonce(nextNonce, tickets))
        );

        require(
            recoverSigner(message, signature) == lpAddress,
            "Must be signed by liquidity provider"
        );

        for (uint256 i = 0; i < tickets.length; i++) {
            sendFunds(
                tickets[i].l1Recipient,
                tickets[i].value,
                tickets[i].token
            );
        }

        nextNonce = nextNonce + tickets.length;
    }
}
