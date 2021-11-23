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
    /// A record of escrow funds indexed by sender then by escrowHash (the hash of the preimage).
    mapping(address => mapping(bytes32 => bytes32)) escrowEntryHashes;

    /// If a ticket has passed the claimExpiry, then the sender can reclaim the funds.
    function refund(EscrowEntry calldata entry) public {
        bytes32 entryHash = keccak256(abi.encode(entry));

        // CHECKS
        require(
            escrowEntryHashes[entry.sender][entry.escrowHash] == entryHash,
            "Invalid escrow entry hash"
        );
        require(
            block.timestamp > entry.claimExpiry,
            "Funds are not reclaimable yet."
        );

        // EFFECTS
        entry.sender.transfer(entry.value);
        // Clear the escrow entry now that the funds are refunded.
        escrowEntryHashes[entry.receiver][entryHash] = 0;
    }

    /// If a ticket has not expired yet (block.timestamp<=claimExpiry) then the funds can be unlocked by the receiver using this function.
    function claimFunds(
        bytes32[] calldata escrowSecret,
        EscrowEntry calldata entry
    ) public {
        bytes32 entryHash = keccak256(abi.encode(entry));

        // CHECKS
        require(
            escrowEntryHashes[entry.sender][entryHash] == entryHash,
            "There are no funds to claim"
        );

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

        // EFFECTS
        entry.receiver.transfer(entry.value);
        // Clear the escrow entry now that the funds have been claimed.
        escrowEntryHashes[entry.receiver][entryHash] = 0;
    }

    /// This function is called by the sender to lock funds in escrow.
    /// The receiver can claim the escrow funds until the claimExpiry. After that the funds can only be reclaimed by the sender.
    function lockFundsInEscrow(EscrowEntry calldata entry) public payable {
        bytes32 existing = escrowEntryHashes[entry.receiver][entry.escrowHash];
        require(
            existing == 0,
            "There is already an escrow entry for escrowHash."
        );

        bytes32 entryHash = keccak256(abi.encode(entry));
        escrowEntryHashes[entry.receiver][entryHash] = entryHash;
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
        // CHECKS
        require(
            ticket.sender == ticketSigner,
            "The ticket must be signed by the sender."
        );
        // EFFECTS
        ticketCommitments[ticket.sender][ticket.senderNonce] = ticketHash;
    }

    /// This is used by Alice to reclaim her funds if Bob is acting maliciously and signing multiple tickets with the same nonce.
    /// Alice must provide the ticket Bob commited to on L2 and anothe ticket with the same nonce.
    function proveFraud(
        WithdrawalTicket calldata commitedTicket,
        Signature calldata firstSignature,
        WithdrawalTicket calldata secondTicket,
        Signature calldata secondSignature,
        EscrowEntry calldata entry,
        bytes32 escrowSecret
    ) public {
        bytes32 commitedHash = keccak256(abi.encode(commitedTicket));
        address commitedSigner = recoverSigner(commitedHash, firstSignature);

        bytes32 secondHash = keccak256(abi.encode(secondTicket));
        address secondSigner = recoverSigner(secondHash, secondSignature);

        bytes32 escrowHash = keccak256(abi.encode(escrowSecret));
        bytes32 entryHash = keccak256(abi.encode(entry));

        // CHECKS
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

        require(
            entryHash == escrowEntryHashes[commitedTicket.sender][escrowHash],
            "The escrow entry does not match the entry hash"
        );

        require(
            block.timestamp <= commitedTicket.expiry,
            "The ticket has expired."
        );

        // EFFECTS
        entry.receiver.transfer(entry.value);
    }
}
