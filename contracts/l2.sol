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

// Authorized: all tickets in this batch are authorized but not claimed
// Claimed: all tickets in this batch are claimed
// Refunded: all tickets in this batch have been refunded, due to inactivity or provable fraud.
enum BatchStatus {
    Authorized,
    Claimed,
    Refunded
}

struct Batch {
    uint256 numTickets;
    uint256 total;
    uint256 authorizedAt;
    BatchStatus status;
}

// TODO: update these values after prototype phase
uint256 constant maxAuthDelay = 60;
uint256 constant safetyDelay = 60;

contract L2 is SignatureChecker {
    Ticket[] public tickets;
    // `batches` is used to record the fact that tickets with nonce between startingNonce and startingNonce + numTickets-1 are authorized, claimed or refunded.
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

    function authorizeWithdrawal(
        uint256 first,
        uint256 last,
        Signature calldata signature
    ) public {
        (
            Batch memory batch,
            TicketsWithIndex memory ticketsWithIndex
        ) = createBatch(first, last);
        bytes32 message = keccak256(abi.encode(ticketsWithIndex));
        uint256 earliestTimestamp = tickets[first].timestamp;

        require(nextNonceToAuthorize == first, "Batches must be gapless");
        require(
            recoverSigner(message, signature) == lpAddress,
            "Must be signed by liquidity provider"
        );
        uint256 maxAuthTime = earliestTimestamp + maxAuthDelay;
        require(
            block.timestamp <= maxAuthTime,
            "Must be within autorization window"
        );

        batches[first] = batch;
        nextNonceToAuthorize = last + 1;
    }

    function createBatch(uint256 first, uint256 last)
        private
        view
        returns (Batch memory, TicketsWithIndex memory)
    {
        Ticket[] memory ticketsToAuthorize = new Ticket[](last - first + 1);
        uint256 total = 0;
        for (uint256 i = first; i <= last; i++) {
            ticketsToAuthorize[i - first] = tickets[i];
            total += tickets[i].value;
        }
        return (
            Batch({
                numTickets: last - first + 1,
                total: total,
                authorizedAt: block.timestamp,
                status: BatchStatus.Authorized
            }),
            TicketsWithIndex(first, ticketsToAuthorize)
        );
    }

    function claimL2Funds(uint256 first) public {
        Batch memory batch = batches[first];
        require(
            batch.status == BatchStatus.Authorized,
            "Batch status must be Authorized"
        );
        require(
            block.timestamp > batch.authorizedAt + safetyDelay,
            "safetyDelay must have passed since authorization timestamp"
        );

        batch.status = BatchStatus.Claimed;
        batches[first] = batch;
        (bool sent, ) = lpAddress.call{value: batch.total}("");
        require(sent, "Failed to send Ether");
    }

    function refundOnFraud(
        uint256 honestStartNonce,
        uint256 honestDelta,
        uint256 fraudStartNonce,
        uint256 fraudDelta,
        Ticket[] calldata fraudTickets,
        Signature calldata fraudSignature
    ) public {
        isProvableFraud(
            honestStartNonce,
            honestDelta,
            fraudStartNonce,
            fraudDelta,
            fraudTickets,
            fraudSignature
        );

        Batch memory batch = batches[honestStartNonce];
        uint256 lastNonce = honestStartNonce + fraudDelta;

        // If the ticket has never been authorized, it is not part of any batch
        // Below checks whether "batch" is null (since there is never a batch with numTickets == 0)
        if (batch.numTickets == 0) {
            require(
                lastNonce >= nextNonceToAuthorize,
                "The nonce must not be authorized"
            );
            (batch, ) = createBatch(
                nextNonceToAuthorize,
                honestStartNonce + fraudDelta
            );
            batches[nextNonceToAuthorize] = batch;
            batch.status = BatchStatus.Authorized;
            nextNonceToAuthorize = lastNonce + 1;
        }
        require(
            batch.status == BatchStatus.Authorized,
            "Batch status must be authorized"
        );

        for (uint256 i = honestStartNonce; i <= lastNonce; i++) {
            (bool sent, ) = tickets[i].l1Recipient.call{
                value: tickets[i].value
            }("");
            require(sent, "Failed to send Ether");
        }

        batches[honestStartNonce].status = BatchStatus.Refunded;
    }

    function isProvableFraud(
        uint256 honestStartNonce,
        uint256 honestDelta,
        uint256 fraudStartNonce,
        uint256 fraudDelta,
        Ticket[] calldata fraudTickets,
        Signature calldata fraudSignature
    ) private view {
        bytes32 message = keccak256(
            abi.encode(TicketsWithIndex(fraudStartNonce, fraudTickets))
        );
        require(
            honestStartNonce + honestDelta == fraudStartNonce + fraudDelta,
            "Honest and fraud indices must match"
        );
        require(
            recoverSigner(message, fraudSignature) == lpAddress,
            "Must be signed by liquidity provider"
        );

        Ticket memory correctTicket = tickets[honestStartNonce + honestDelta];
        Ticket memory fraudTicket = fraudTickets[fraudDelta];
        require(
            correctTicket.l1Recipient != fraudTicket.l1Recipient ||
                correctTicket.value != fraudTicket.value ||
                correctTicket.timestamp != fraudTicket.timestamp,
            "Honest and fraud tickets must differ"
        );
    }
}
