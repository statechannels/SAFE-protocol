// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

/// This represents an amount of funds locked in escrow on behalf of the sender.
struct EscrowEntry {
    /// Who will receive the funds if unlocked with the preimage
    address payable receiver;
    /// Who will send the funds if unlocked with the preimage.
    address payable sender;
    /// The amount of funds to send.
    uint256 value;
    /// After this timestamp a receiver may claim the funds using the preimage.
    uint256 claimStart;
    /// After this timestamp the receiver may no longer claim the funds, the sender can refund them.
    uint256 claimExpiry;
    /// This is the hash of some secret preimage chosen by the sender.
    bytes32 escrowHash;
}

contract L2Contract is SignatureChecker {
    /// A record of escrow funds indexed by sender then escrowHash.
    mapping(address => mapping(bytes32 => EscrowEntry)) escrowEntries;

    /// If a ticket has passed the claimExpiry, then the sender can reclaim the funds.
    function refund(address payable receiver, bytes32 escrowHash) public {
        EscrowEntry memory entry = escrowEntries[receiver][escrowHash];

        require(
            block.timestamp > entry.claimExpiry,
            "Funds are not reclaimable yet."
        );

        entry.sender.transfer(entry.value);
    }

    /// If a ticket has not expired yet (block.timestamp<=claimExpiry) then the funds can be unlocked by the receiver using this function.
    function claimFunds(bytes32[] calldata escrowSecret, bytes32 escrowHash)
        public
    {
        EscrowEntry memory entry = escrowEntries[msg.sender][escrowHash];

        require(
            block.timestamp <= entry.claimExpiry,
            "The escrow claim period has expired."
        );

        require(
            block.timestamp >= entry.claimStart,
            "The escrow claim period has not started"
        );
        require(
            entry.escrowHash == keccak256(abi.encode(escrowSecret)),
            "Invalid preimage."
        );

        entry.receiver.transfer(entry.value);
    }

    /// This function is called by the sender to lock funds in escrow.
    /// The receiver can claim the escrow funds until the claimExpiry. After that the funds can only be reclaimed by the sender.
    function lockFundsInEscrow(
        address payable receiver,
        bytes32 escrowHash,
        uint256 claimStart,
        uint256 claimExpiry
    ) public payable {
        EscrowEntry memory entry = escrowEntries[receiver][escrowHash];

        require(entry.value == 0, "Funds already locked in escrow");

        // TODO: https://github.com/statechannels/fast-exit/issues/4
        escrowEntries[receiver][escrowHash] = EscrowEntry(
            receiver,
            payable(msg.sender),
            msg.value,
            claimStart,
            claimExpiry,
            escrowHash
        );
    }

    /// A record of ticket commitment hashes  indexed by sender then nonce.
    mapping(address => mapping(uint256 => bytes32)) ticketCommitments;

    /// This is used to commit to a ticket on L2.
    /// It serves two purposes:
    /// 1. It broadcasts the signed ticket out to the network.
    /// 2. It keeps track of commitments made so fraud can be penalized.
    function commitToWithdrawal(
        WithdrawalTicket calldata ticket,
        Signature calldata ticketSignature
    ) public {
        bytes32 ticketHash = keccak256(abi.encode(ticket));
        address ticketSigner = recoverSigner(ticketHash, ticketSignature);

        require(
            ticket.sender == ticketSigner,
            "The ticket must be signed by the sender."
        );

        ticketCommitments[ticket.sender][ticket.senderNonce] = ticketHash;
    }

    /// This is used by Alice to reclaim her funds if Bob is acting maliciously and signing multiple tickets with the same nonce.
    /// Alice must provide the ticket Bob commited to on L2 and anothe ticket with the same nonce.
    function proveFraud(
        WithdrawalTicket calldata commitedTicket,
        Signature calldata firstSignature,
        WithdrawalTicket calldata secondTicket,
        Signature calldata secondSignature,
        bytes32 escrowSecret
    ) public {
        bytes32 commitedHash = keccak256(abi.encode(commitedTicket));
        address commitedSigner = recoverSigner(commitedHash, firstSignature);

        bytes32 secondHash = keccak256(abi.encode(secondTicket));
        address secondSigner = recoverSigner(secondHash, secondSignature);

        require(commitedHash != secondHash, "Tickets must be distinct");

        require(
            commitedSigner == secondSigner,
            "The two tickets must be signed by the same signer."
        );
        require(
            ticketCommitments[commitedTicket.sender][
                commitedTicket.senderNonce
            ] == commitedHash,
            "The ticket must be commited to"
        );

        require(
            commitedTicket.senderNonce == secondTicket.senderNonce,
            "The two tickets must have the same nonce."
        );

        bytes32 escrowHash = keccak256(abi.encode(escrowSecret));
        EscrowEntry memory entry = escrowEntries[msg.sender][escrowHash];

        require(entry.escrowHash == escrowHash, "Invalid preimage.");

        require(
            block.timestamp <= commitedTicket.expiry,
            "The ticket has expired."
        );

        entry.receiver.transfer(entry.value);
    }
}
