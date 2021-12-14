// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

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
    uint256 numTickets;
    uint256 total;
    uint256 timestamp;
    BatchStatus status;
}

// TODO: update these values after prototype phase
uint256 constant maxAuthDelay = 60;
uint256 constant safetyDelay = 60;

contract L2 is SignatureChecker {
    Ticket[] public tickets;
    // `batches` is used to record the fact that tickets with nonce between startingNonce and startingNonce + numTickets-1 are authorized, claimed or returned.
    // Indexed by nonce
    mapping(uint256 => Batch) batches;
    uint256 nextNonceToAuthorize = 0;

    // TODO: check payment amount
    function depositOnL2(L2Deposit calldata deposit) public payable {
        uint256 amountAvailable = deposit.trustedAmount;
        uint256 trustedNonce = deposit.trustedNonce;

        uint256 amountReserved = 0;
        for (uint256 i = trustedNonce; i < tickets.length; i++) {
            amountReserved += tickets[i].value;
        }

        // We don't allow tickets to be registered if there are not enough funds
        // remaining on L1 after accounting for already registered tickets.
        require(
            amountAvailable >= amountReserved + deposit.depositAmount,
            "Must have enough funds for ticket"
        );
        require(
            msg.value == deposit.depositAmount,
            "Value sent must match depositAmount"
        );
        Ticket memory ticket = Ticket({
            l1Recipient: deposit.l1Recipient,
            value: deposit.depositAmount,
            timestamp: block.timestamp
        });

        // ticket's nonce is now its index in `tickets`
        tickets.push(ticket);
    }

    // TODO: validate that batches are non-overlapping.
    function authorizeWithdrawal(
        uint256 first,
        uint256 last,
        Signature calldata signature
    ) public {
        Ticket[] memory ticketsToAuthorize = new Ticket[](last - first + 1);
        uint256 total = 0;
        for (uint256 i = first; i <= last; i++) {
            ticketsToAuthorize[i - first] = tickets[i];
            total += tickets[i].value;
        }
        bytes32 message = keccak256(
            abi.encode(TicketsWithIndex(first, ticketsToAuthorize))
        );
        uint256 earliestTimestamp = tickets[first].timestamp;

        require(nextNonceToAuthorize == first, "Batches must be gapless");
        require(
            recoverSigner(message, signature) == lpAddress,
            "Must be signed by liquidity provider"
        );
        require(
            earliestTimestamp + maxAuthDelay > block.timestamp,
            "Must be within autorization window"
        );

        batches[first] = Batch({
            numTickets: last - first + 1,
            total: total,
            timestamp: block.timestamp,
            status: BatchStatus.Pending
        });
        nextNonceToAuthorize = last + 1;
    }

    function claimL2Funds(uint256 first) public {
        Batch memory batch = batches[first];
        require(
            batch.status == BatchStatus.Pending,
            "Batch status must be pending"
        );
        require(
            batch.timestamp + safetyDelay < block.timestamp,
            "Must be after safetyDelay"
        );

        batch.status = BatchStatus.Claimed;
        batches[first] = batch;
        (bool sent, ) = lpAddress.call{value: batch.total}("");
        require(sent, "Failed to send Ether");
    }
}
