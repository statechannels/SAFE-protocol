// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

struct WithdrawalTicket {
    uint256 value;
    uint256 nonce;
    address payable receiver;
    address sender;
    bytes32 escrowHash;
}

struct EscrowEntry {
    // Who will receive the funds if unlocked with the preimage.
    address payable receiver;
    // Who will send the funds if unlocked with the preimage..
    address payable sender;
    // The amount of funds to send.
    uint256 value;
    // This is a timestamp of when the escrow can be claimed by the receiver
    uint256 payoutDate;
    // This is a timestamp of when the funds can reclaimed back to the original sender
    uint256 reclaimDate;
    // This is the hash of some secret preimage.
    bytes32 escrowHash;
}

// GK: I believe payoutDate > reclaimDate for safety.
contract L2Contract {
    mapping(address => EscrowEntry) private funds;

    function reclaimFunds(
        address payable receiver,
        bytes32[] calldata escrowSecret
    ) public {
        EscrowEntry memory entry = funds[receiver];
        require(
            entry.reclaimDate >= block.timestamp,
            "Funds are not reclaimable yet."
        );
        require(
            entry.escrowHash == keccak256(abi.encode(escrowSecret)),
            "Invalid preimage."
        );

        entry.sender.transfer(entry.value);
    }

    function transferFunds(bytes32[] calldata escrowSecret) public {
        EscrowEntry memory entry = funds[msg.sender];

        require(
            entry.payoutDate >= block.timestamp,
            "Funds are not payable yet."
        );
        require(
            entry.escrowHash == keccak256(abi.encode(escrowSecret)),
            "Invalid preimage."
        );

        entry.receiver.transfer(entry.value);
    }

    function lockFundsInEscrow( 
        // Called by Alice, with receiver = Bob. 
        // It's a hash-time-lock, with a window of opportunity for Bob.
        // Alice will pull her funds out unless she gets funds from Bob on L1 before reclaimDate
        address payable receiver,
        bytes32 escrowHash,
        uint256 payoutDate,
        uint256 reclaimDate
    ) public payable {
        EscrowEntry memory entry = funds[receiver];
        require(entry.value == 0, "Funds already locked in escrow");
        require(
            entry.sender == msg.sender,
            "Cannot add an entry for a different address"
        );
        funds[receiver] = EscrowEntry(
            receiver,
            payable(msg.sender),
            msg.value,
            payoutDate,
            reclaimDate,
            escrowHash
        );
    }

    uint256 currentNonce = 0;
    mapping(address => bytes32) ticketCommitments;

    function commitToWithdrawal( // Called by Bob, with the ticket.receiver = Alice. He is commiting to an L1 withdrawal
        WithdrawalTicket calldata ticket,
        bytes32 ticketSignature
    ) public {
        require(
            ticket.nonce == currentNonce + 1,
            "The ticket must use the next nonce."
        );

        bytes32 ticketHash = keccak256(abi.encode(ticket));
        address ticketSigner = recoverSigner(ticketHash, ticketSignature);

        require(
            ticket.sender == ticketSigner,
            "The ticket must be signed by the sender."
        );

        currentNonce++;
        ticketCommitments[ticket.sender] = ticketHash;
    }

    function proveFraud(
        WithdrawalTicket calldata commitedTicket,
        bytes32 firstSignature,
        WithdrawalTicket calldata secondTicket,
        bytes32 secondSignature,
        bytes32 escrowSecret
    ) public {
        bytes32 commitedHash = keccak256(abi.encode(commitedTicket));
        address commitedSigner = recoverSigner(commitedHash, firstSignature);

        bytes32 secondHash = keccak256(abi.encode(secondTicket));
        address secondSigner = recoverSigner(secondHash, secondSignature);

        require(
            commitedSigner == secondSigner,
            "The two tickets must be signed by the same signer."
        );
        require(
            ticketCommitments[commitedTicket.sender] == commitedHash,
            "The ticket must be commited to"
        );

        require(
            commitedTicket.nonce == secondTicket.nonce,
            "The two tickets must have the same nonce."
        );

        EscrowEntry memory entry = funds[msg.sender];

        require(
            entry.escrowHash == keccak256(abi.encode(escrowSecret)),
            "Invalid preimage."
        );

        entry.receiver.transfer(entry.value);
    }

    function recoverSigner(bytes32, bytes32) public pure returns (address) {
        // TODO: Implement signature recovery
        return address(0);
    }
}
