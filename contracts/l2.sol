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
// Withdrawn: all tickets in this batch are withdrawn (either claimed or refunded)
enum BatchStatus {
    Authorized,
    Withdrawn
}

struct Batch {
    uint256 numTickets;
    uint256 total;
    uint256 authorizedAt;
    BatchStatus status;
}

// TODO: update these values after prototype phase
uint256 constant maxAuthDelay = 600;
uint256 constant safetyDelay = 600;

contract L2 is SignatureChecker {
    Ticket[] public tickets;
    // `batches` is used to record the fact that tickets with nonce between startingNonce and startingNonce + numTickets-1 are authorized or withdrawn.
    // Indexed by nonce
    mapping(uint256 => Batch) batches;
    uint256 nextBatchStart = 0;

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
            createdAt: block.timestamp
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
            TicketsWithNonce memory ticketsWithNonce
        ) = createBatch(first, last);
        bytes32 message = keccak256(abi.encode(ticketsWithNonce));
        uint256 earliestTimestamp = tickets[first].createdAt;

        require(nextBatchStart == first, "Batches must be gapless");
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
        nextBatchStart = last + 1;
    }

    function createBatch(uint256 first, uint256 last)
        private
        view
        returns (Batch memory, TicketsWithNonce memory)
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
            TicketsWithNonce(first, ticketsToAuthorize)
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

        batch.status = BatchStatus.Withdrawn;
        batches[first] = batch;
        (bool sent, ) = lpAddress.call{value: batch.total}("");
        require(sent, "Failed to send Ether");
    }

    /**
     * @notice Prove fraud and refund all tickets in the fraudulent batch
     * @param honestStartNonce Index of the first ticket in the honest batch
     * @param honestDelta Offset from honestStartNonce to the honest ticket
     * @param fraudStartNonce Index of the first ticket in the fraudulent batch
     * @param fraudDelta Offset from fraudStartNonce to the fraudulent ticket
     * @param fraudTickets All tickets in the fraudulent batch
     * @param fraudSignature Signature on the fraudulent batch
     */
    function refundOnFraud(
        uint256 honestStartNonce,
        uint256 honestDelta,
        uint256 fraudStartNonce,
        uint256 fraudDelta,
        Ticket[] calldata fraudTickets,
        Signature calldata fraudSignature
    ) public {
        bytes32 message = keccak256(
            abi.encode(TicketsWithNonce(fraudStartNonce, fraudTickets))
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
            keccak256(abi.encode(correctTicket)) !=
                keccak256(abi.encode(fraudTicket)),
            "Honest and fraud tickets must differ"
        );

        Batch memory honestBatch = batches[honestStartNonce];
        require(
            honestBatch.status == BatchStatus.Authorized,
            "Batch status must be Authorized"
        );

        for (uint256 i = honestStartNonce; i < honestBatch.numTickets; i++) {
            (bool sent, ) = tickets[i].l1Recipient.call{
                value: tickets[i].value
            }("");
            require(sent, "Failed to send Ether");
        }

        batches[honestStartNonce].status = BatchStatus.Withdrawn;
    }

    /**
     * @notice Refund all tickets with nonce >= nextBatchStart and nonce <= lastNonce
     * @param lastNonce Nonce of the "expired" ticket aka a ticket that is past AuthorizationWindow
     */
    function refund(uint256 lastNonce) public {
        require(
            block.timestamp > tickets[lastNonce].createdAt + maxAuthDelay,
            "maxAuthDelay must have passed since deposit"
        );

        require(
            nextBatchStart <= lastNonce,
            "The nonce must not be a part of a batch"
        );
        (Batch memory batch, ) = createBatch(nextBatchStart, lastNonce);
        batches[nextBatchStart] = batch;
        batch.status = BatchStatus.Withdrawn;
        nextBatchStart = lastNonce + 1;

        (bool sent, ) = tickets[lastNonce].l1Recipient.call{
            value: tickets[lastNonce].value
        }("");
        require(sent, "Failed to send Ether");
    }
}
