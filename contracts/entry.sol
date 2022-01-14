// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

contract EntryChainEscrow is SignatureChecker {
    uint256 nextNonce = 0;
    // TODO: Eventually this should probably use a well-tested ownership library.
    address owner;

    receive() external payable {}

    constructor() {
        owner = msg.sender;
    }

    function claimBatch(
        EntryChainTicket[] calldata tickets,
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
            IERC20 tokenContract = IERC20(tickets[i].token);
            tokenContract.transfer(
                tickets[i].entryChainRecipient,
                tickets[i].value
            );
        }

        nextNonce = nextNonce + tickets.length;
    }
}
