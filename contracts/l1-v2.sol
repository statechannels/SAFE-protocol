// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common-v2.sol";

uint256 constant l1ClaimWindow = 120;

contract l1 is SignatureChecker {
    uint256 latestNonceWithdrawn = 0;

    function claimBatch(
        RegisteredSwap[] calldata swaps,
        Signature calldata signature
    ) public {
        uint256 firstNonce = latestNonceWithdrawn + 1;
        bytes32 message = keccak256(abi.encode(SignedSwaps(firstNonce, swaps)));

        // TODO: update to Bob
        require(recoverSigner(message, signature) == address(0));
        require(swaps[0].timestamp + l1ClaimWindow > block.timestamp);

        for (uint256 i = 0; i < swaps.length; i++) {
            swaps[i].l1Recipient.call{value: swaps[i].value}("");
        }

        latestNonceWithdrawn = firstNonce + swaps.length; // maybe off by one;
    }
}
