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
    /// The address of the ERC20 token.
    address token;
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

struct TokenPair {
    address l1Token;
    address l2Token;
}

// TODO: update these values after prototype phase
uint256 constant maxAuthDelay = 600;
uint256 constant safetyDelay = 600;

contract L2 is SignatureChecker {
    Ticket[] public tickets;
    // `batches` is used to record the fact that tickets with nonce between startingNonce and startingNonce + numTickets-1 are authorized or withdrawn.
    // Indexed by nonce
    mapping(uint256 => Batch) batches;

    /// Maps a L1 token address to the L2 token address.
    mapping(address => address) public l1TokenMap;
    /// Maps a L2 token address to the L1 token address.
    mapping(address => address) public l2TokenMap;
    uint256 nextBatchStart = 0;

    constructor(TokenPair[] memory pairs) {
        for (uint256 i = 0; i < pairs.length; i++) {
            l2TokenMap[pairs[i].l2Token] = pairs[i].l1Token;
            l1TokenMap[pairs[i].l1Token] = pairs[i].l2Token;
        }
    }

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
            l2TokenMap[deposit.token] != address(0),
            "There is no L2 token for this L1 token"
        );

        IERC20 tokenContract = IERC20(deposit.token);
        tokenContract.transferFrom(
            msg.sender,
            address(this),
            deposit.depositAmount
        );

        Ticket memory ticket = Ticket({
            l1Recipient: deposit.l1Recipient,
            value: deposit.depositAmount,
            createdAt: block.timestamp,
            token: l2TokenMap[deposit.token]
        });

        // ticket's nonce is now its index in `tickets`
        tickets.push(ticket);
    }

    // TODO: This public function is added to force hardhat to generate
    // the TicketStruct type in its l2.ts output
    function compareWithFirstTicket(Ticket calldata t)
        public
        view
        returns (bool)
    {
        return tickets[0].value == t.value;
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
        L1Ticket[] memory ticketsToAuthorize = new L1Ticket[](last - first + 1);
        uint256 total = 0;
        for (uint256 i = first; i <= last; i++) {
            Ticket memory t = tickets[i];
            ticketsToAuthorize[i - first] = L1Ticket(
                t.l1Recipient,
                t.value,
                t.token
            );
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

        for (uint256 i = first; i < first + batch.numTickets; i++) {
            Ticket memory ticket = tickets[i];
            // Since the ticket token is validated when it is registered, we can be sure that l1TokenMap[ticket.token])!= address(0)
            IERC20 tokenContract = IERC20(l1TokenMap[ticket.token]);
            tokenContract.transfer(lpAddress, ticket.value);
        }
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
        L1Ticket[] calldata fraudTickets,
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

        Ticket memory t = tickets[honestStartNonce + honestDelta];
        L1Ticket memory correctTicket = L1Ticket(
            t.l1Recipient,
            t.value,
            t.token
        );
        L1Ticket memory fraudTicket = fraudTickets[fraudDelta];
        require(
            !ticketsEqual(correctTicket, fraudTicket),
            "Honest and fraud tickets must differ"
        );

        Batch memory honestBatch = batches[honestStartNonce];
        require(
            honestBatch.status == BatchStatus.Authorized,
            "Batch status must be Authorized"
        );

        for (uint256 i = honestStartNonce; i < honestBatch.numTickets; i++) {
            // Since the ticket token is validated when it is registered, we can be sure that l1TokenMap[ticket.token])!= address(0)
            IERC20 tokenContract = IERC20(l1TokenMap[tickets[i].token]);
            tokenContract.transfer(tickets[i].l1Recipient, tickets[i].value);
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
        // Since the ticket token is validated when it is registered, we can be sure that l1TokenMap[ticket.token])!= address(0)
        IERC20 tokenContract = IERC20(l1TokenMap[tickets[lastNonce].token]);
        tokenContract.transfer(
            tickets[lastNonce].l1Recipient,
            tickets[lastNonce].value
        );
    }
}
