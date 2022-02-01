// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

struct FromChainDeposit {
    // the nonce of the most recent "ToChainAmountAssertion" that Alice trusts
    uint256 trustedNonce;
    // the amount that Alice believes to be available on ToChain for tickets with
    // nonce *greater than trustedNonce*
    uint256 trustedAmount;
    // the amount Alice wishes to claim on ToChain
    uint256 depositAmount;
    // Alice's address on ToChain
    address toChainRecipient;
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
    address toChainToken;
    address fromChainToken;
}

// TODO: update these values after prototype phase
uint256 constant maxAuthDelay = 600;
uint256 constant safetyDelay = 600;

contract FromChainEscrow is SignatureChecker {
    Ticket[] public tickets;
    // `batches` is used to record the fact that tickets with nonce between startingNonce and startingNonce + numTickets-1 are authorized or withdrawn.
    // Indexed by nonce
    mapping(uint256 => Batch) batches;

    /// Maps a ToChain token address to the FromChain token address.
    mapping(address => address) public toChainTokenMap;
    /// Maps a FromChain token address to the ToChain token address.
    mapping(address => address) public fromChainTokenMap;
    uint256 nextBatchStart = 0;

    // TODO: Eventually this should probably use a well-tested ownership library.
    address owner;

    constructor() {
        owner = msg.sender;
    }

    function registerTokenPairs(TokenPair[] memory pairs) public {
        require(msg.sender == owner, "Only the owner can add token pairs");
        for (uint256 i = 0; i < pairs.length; i++) {
            require(
                fromChainTokenMap[pairs[i].fromChainToken] == address(0),
                "A mapping exists for the FromChain token"
            );
            require(
                toChainTokenMap[pairs[i].toChainToken] == address(0),
                "A mapping exists for the ToChain token"
            );
            fromChainTokenMap[pairs[i].fromChainToken] = pairs[i].toChainToken;
            toChainTokenMap[pairs[i].toChainToken] = pairs[i].fromChainToken;
        }
    }

    function depositOnFromChain(FromChainDeposit calldata deposit)
        public
        payable
    {
        uint256 amountAvailable = deposit.trustedAmount;
        uint256 trustedNonce = deposit.trustedNonce;
        address toChainToken = fromChainTokenMap[deposit.token];

        uint256 amountReserved = 0;
        for (uint256 i = trustedNonce; i < tickets.length; i++) {
            if (tickets[i].token == toChainToken) {
                amountReserved += tickets[i].value;
            }
        }

        // We don't allow tickets to be registered if there are not enough funds
        // remaining on ToChain after accounting for already registered tickets.
        require(
            amountAvailable >= amountReserved + deposit.depositAmount,
            "Must have enough funds for ticket"
        );

        require(
            toChainToken != address(0),
            "There is no FromChain token for this ToChain token"
        );

        IERC20 tokenContract = IERC20(deposit.token);
        tokenContract.transferFrom(
            msg.sender,
            address(this),
            deposit.depositAmount
        );

        Ticket memory ticket = Ticket({
            toChainRecipient: deposit.toChainRecipient,
            value: deposit.depositAmount,
            createdAt: block.timestamp,
            token: toChainToken
        });

        // ticket's nonce is now its index in `tickets`
        tickets.push(ticket);
    }

    // TODO: This public function is added to force hardhat to generate
    // the TicketStruct type in its fromChain.ts output
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
            recoverSigner(message, signature) == owner,
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
        ToChainTicket[] memory ticketsToAuthorize = new ToChainTicket[](
            last - first + 1
        );
        uint256 total = 0;
        for (uint256 i = first; i <= last; i++) {
            Ticket memory t = tickets[i];
            ticketsToAuthorize[i - first] = ToChainTicket(
                t.toChainRecipient,
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

    function claimFromChainFunds(uint256 first) public {
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
            // Since the ticket token is validated when it is registered, we can be sure that toChainTokenMap[ticket.token])!= address(0)
            IERC20 tokenContract = IERC20(toChainTokenMap[ticket.token]);
            tokenContract.transfer(owner, ticket.value);
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
        ToChainTicket[] calldata fraudTickets,
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
            recoverSigner(message, fraudSignature) == owner,
            "Must be signed by liquidity provider"
        );

        Ticket memory t = tickets[honestStartNonce + honestDelta];
        ToChainTicket memory correctTicket = ToChainTicket(
            t.toChainRecipient,
            t.value,
            t.token
        );
        ToChainTicket memory fraudTicket = fraudTickets[fraudDelta];
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
            // Since the ticket token is validated when it is registered, we can be sure that toChainTokenMap[ticket.token])!= address(0)
            IERC20 tokenContract = IERC20(toChainTokenMap[tickets[i].token]);
            tokenContract.transfer(
                tickets[i].toChainRecipient,
                tickets[i].value
            );
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
        // Since the ticket token is validated when it is registered, we can be sure that toChainTokenMap[ticket.token])!= address(0)
        IERC20 tokenContract = IERC20(
            toChainTokenMap[tickets[lastNonce].token]
        );
        tokenContract.transfer(
            tickets[lastNonce].toChainRecipient,
            tickets[lastNonce].value
        );
    }
}
