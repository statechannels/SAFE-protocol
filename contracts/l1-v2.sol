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
        bytes32 message = keccak256(
            abi.encode(SignedSwaps(latestNonceWithdrawn, swaps))
        );

        require(
            recoverSigner(message, signature) == lpAddress,
            "Signed by liquidity provider"
        );
        require(
            swaps[0].timestamp + l1ClaimWindow > block.timestamp,
            "Within claim window"
        );

        for (uint256 i = 0; i < swaps.length; i++) {
            swaps[i].l1Recipient.call{value: swaps[i].value}("");
        }

        latestNonceWithdrawn = latestNonceWithdrawn + swaps.length; // maybe off by one;
    }
}
