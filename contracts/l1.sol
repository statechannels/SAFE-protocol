// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

contract l1 is SignatureChecker {
    uint256 nextNonce = 0;

    receive() external payable {}

    function claimBatch(
        RegisteredSwap[] calldata swaps,
        Signature calldata signature
    ) public {
        bytes32 message = keccak256(
            abi.encode(SwapsWithIndex(nextNonce, swaps))
        );

        require(
            recoverSigner(message, signature) == lpAddress,
            "Must be signed by liquidity provider"
        );

        for (uint256 i = 0; i < swaps.length; i++) {
            (bool sent, ) = swaps[i].l1Recipient.call{value: swaps[i].value}(
                ""
            );
            require(sent, "Failed to send Ether");
        }

        nextNonce = nextNonce + swaps.length;
    }
}
