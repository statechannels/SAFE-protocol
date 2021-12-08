// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common-v2.sol";

struct L2Deposit {
    // the nonce of the most recent "L1AmountAssertion" that Alice trusts
    uint256 trustedNonce;
    // the amount that Alice believes to be available on L1 for tickets with
    // nonce *greater than trustedNonce*
    uint256 trustedAmount;
    // the amount Alice wishes to claim on L1
    uint256 depositAmount;
    // Alice's address on L1
    address l1Recipient;
}

// Pending: all tickets in this batch are authorized but not claimed
// Claimed: all tickets in this batch are claimed
// Returned: all tickets in this batch have been returned, due to inactivity or provable fraud.
enum BatchStatus {
    Pending,
    Claimed,
    Returned
}

struct Batch {
    uint256 numSwaps;
    uint256 total;
    uint256 earliestTimestamp;
    uint256 latestTimestamp;
    BatchStatus status;
}

// TODO: update these values after prototype phase
uint256 constant authorizationWindow = 60;
uint256 constant l2ClaimWindow = 180;

contract L2 is SignatureChecker {
    RegisteredSwap[] public registeredSwaps;
    // `batches` is used to record the fact that tickets with nonce
    // between startingNonce and startingNonce + numSwaps-1 are
    // authorized, claimed or returned.
    mapping(uint256 => Batch) batches;

    // TODO: check payment amount
    function depositOnL2(L2Deposit calldata deposit) public payable {
        uint256 amountAvailable = deposit.trustedAmount;
        uint256 trustedNonce = deposit.trustedNonce;

        uint256 amountReserved = 0;
        for (uint256 i = trustedNonce; i < registeredSwaps.length; i++) {
            amountReserved += registeredSwaps[i].value;
        }

        // We don't allow swaps to be registered if there are not enough funds
        // remaining on L1 after accounting for already registered swaps.
        require(amountAvailable >= amountReserved + deposit.depositAmount);
        RegisteredSwap memory swap = RegisteredSwap({
            l1Recipient: deposit.l1Recipient,
            value: deposit.depositAmount,
            timestamp: block.timestamp
        });

        // swap's nonce is now its index in `registeredSwaps`
        registeredSwaps.push(swap);
    }

    function authorizeWithdrawal(
        uint256 first,
        uint256 last,
        Signature calldata signature
    ) public {
        RegisteredSwap[] memory swapsToAuthorize = new RegisteredSwap[](
            last - first + 1
        );
        uint256 total = 0;
        for (uint256 i = first; i <= last; i++) {
            swapsToAuthorize[i - first] = registeredSwaps[i];
            total += registeredSwaps[i].value;
        }
        bytes32 message = keccak256(
            abi.encode(SwapsWithIndex(first, swapsToAuthorize))
        );
        uint256 earliestTimestamp = registeredSwaps[first].timestamp;

        require(
            recoverSigner(message, signature) == lpAddress,
            "Signed by liquidity provider"
        );
        require(
            earliestTimestamp + authorizationWindow > block.timestamp,
            "Within autorization window"
        );

        batches[first] = Batch({
            numSwaps: last - first + 1,
            total: total,
            earliestTimestamp: earliestTimestamp,
            latestTimestamp: registeredSwaps[last].timestamp,
            status: BatchStatus.Pending
        });
    }

    function claimL2Funds(uint256 first) public {
        Batch memory batch = batches[first];
        require(batch.status == BatchStatus.Pending, "Batch is pending");
        require(
            batch.latestTimestamp + authorizationWindow < block.timestamp,
            "After authorization window"
        );
        require(
            batch.earliestTimestamp + l2ClaimWindow > block.timestamp,
            "Before end of claim window"
        );

        batch.status = BatchStatus.Claimed;
        batches[first] = batch;
        lpAddress.call{value: batch.total}("");
    }
}
