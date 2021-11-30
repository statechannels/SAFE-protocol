// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

/// This represents an amount of funds locked in escrow on behalf of the sender (Alice)
struct EscrowEntry {
    /// Who will receive the funds if unlocked with the preimage (Bob).
    address payable receiver;
    /// Who will send the funds if unlocked with the preimage (Alice).
    address payable sender;
    /// The amount of funds to send.
    uint256 value;
    /// After this timestamp a receiver may claim the funds using the preimage.
    uint256 claimStart;
    /// After this timestamp the receiver may no longer claim the funds, the sender can refund them.
    uint256 claimExpiry;
    /// This is the hash of some secret preimage chosen by the sender (Alice).
    bytes32 escrowHash;
}

contract L2Contract is SignatureChecker {
    /// A record of escrow funds indexed by sender then by escrowHash (the hash of the preimage).
    mapping(address => mapping(bytes32 => bytes32)) escrowEntryHashes;

    /// If Bob never claims the funds, Alice can reclaim them after the entry.claimExpiry timestamp.
    function refund(EscrowEntry calldata entry) public {
        bytes32 entryHash = keccak256(abi.encode(entry));

        // CHECKS
        require(
            escrowEntryHashes[entry.receiver][entry.escrowHash] == entryHash,
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

    /// Used by Bob to claim funds Alice has locked in escrow.
    /// Bob needs to know the escrowSecret preimage to unlock the funds.
    function claimFunds(bytes32 escrowSecret, EscrowEntry calldata entry)
        public
    {
        // CHECKS
        require(
            escrowEntryHashes[entry.receiver][entry.escrowHash] != 0,
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
        escrowEntryHashes[entry.receiver][entry.escrowHash] = 0;
    }

    /// Used by Alice to lock funds in escrow for Bob.
    /// Bob can claim the funds before entry.claimExpiry with the preimage escrowSecret.
    /// After entry.claimExpiry if Bob hasn't claimed the funds, Alice can reclaim them.
    function lockFundsInEscrow(EscrowEntry calldata entry) public payable {
        bytes32 entryHash = keccak256(abi.encode(entry));
        bytes32 existing = escrowEntryHashes[entry.receiver][entry.escrowHash];

        // CHECKS
        require(
            existing == 0,
            "There is already an escrow entry for escrowHash."
        );
        // We could accept more than entry.value and refund the difference.
        // For now we only accept the exact amount for simplicity.
        require(msg.value == entry.value, "Incorrect amount of funds");

        // EFFECTS
        escrowEntryHashes[entry.receiver][entry.escrowHash] = entryHash;
    }

    /// A record of ticket commitment hashes  indexed by sender then nonce.
    mapping(address => mapping(uint256 => bytes32)) ticketCommitments;

    /// This is used to commit to a ticket on L2.
    /// It serves two purposes:
    /// 1. It broadcasts the signed ticket out to the network.
    /// 2. It keeps track of commitments made so fraud can be penalized.
    /// This is called by Bob to commit to a ticket to transfer L1 funds to Alice.
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
