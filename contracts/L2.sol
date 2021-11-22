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
    /// After this timestamp the escrow expires and the receiver cannot claim the funds.
    uint256 escrowExpiry;
    /// This is the hash of some secret preimage chosen by the sender.
    bytes32 escrowHash;
}

contract L2Contract {
    /// A record of escrow funds indexed by sender.
    mapping(address => EscrowEntry) escrowEntries;

    /// If a ticket has passed the escrowExpiry, then the sender can reclaim the funds.
    function reclaimFunds(
        address payable receiver,
        bytes32[] calldata escrowSecret
    ) public {
        EscrowEntry memory entry = escrowEntries[receiver];

        require(
            block.timestamp > entry.escrowExpiry,
            "Funds are not reclaimable yet."
        );
        require(
            entry.escrowHash == keccak256(abi.encode(escrowSecret)),
            "Invalid preimage."
        );

        entry.sender.transfer(entry.value);
    }

    /// If a ticket has not expired yet (block.timestamp<=escrowExpiry) then the funds can be unlocked by the receiver using this function.
    function transferFunds(bytes32[] calldata escrowSecret) public {
        EscrowEntry memory entry = escrowEntries[msg.sender];

        require(
            block.timestamp <= entry.escrowExpiry,
            "The escrow payout time limit has expired."
        );
        require(
            entry.escrowHash == keccak256(abi.encode(escrowSecret)),
            "Invalid preimage."
        );

        entry.receiver.transfer(entry.value);
    }

    /// This function is called by the sender to lock funds in escrow.
    /// The receiver can claim the escrow funds until the escrowExpiry. After that the funds can only be reclaimed by the sender.
    function lockFundsInEscrow(
        address payable receiver,
        bytes32 escrowHash,
        uint256 escrowExpiry
    ) public payable {
        EscrowEntry memory entry = escrowEntries[receiver];

        // TODO: https://github.com/statechannels/fast-exit/issues/8
        require(entry.value == 0, "Funds already locked in escrow");

        // TODO: https://github.com/statechannels/fast-exit/issues/4
        escrowEntries[receiver] = EscrowEntry(
            receiver,
            payable(msg.sender),
            msg.value,
            escrowExpiry,
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

        EscrowEntry memory entry = escrowEntries[msg.sender];

        require(
            entry.escrowHash == keccak256(abi.encode(escrowSecret)),
            "Invalid preimage."
        );

        require(
            block.timestamp <= commitedTicket.expiry,
            "The ticket has expired."
        );

        entry.receiver.transfer(entry.value);
    }

    function recoverSigner(bytes32 hash, Signature memory signature)
        public
        pure
        returns (address)
    {
        bytes32 prefixedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
        );
        return ecrecover(prefixedHash, signature.v, signature.r, signature.s);
    }
}
