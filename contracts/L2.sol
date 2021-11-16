// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

struct Signature {
    bytes32 r;
    bytes32 s;
    uint8 v;
}

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
    mapping(address => EscrowEntry) private escrowEntries;

    function reclaimFunds(
        address payable receiver,
        bytes32[] calldata escrowSecret
    ) public {
        EscrowEntry memory entry = escrowEntries[receiver];

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
        EscrowEntry memory entry = escrowEntries[msg.sender];

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
        EscrowEntry memory entry = escrowEntries[receiver];
        require(entry.value == 0, "Funds already locked in escrow");
        escrowEntries[receiver] = EscrowEntry(
            receiver,
            payable(msg.sender),
            msg.value,
            payoutDate,
            reclaimDate,
            escrowHash
        );
    }

    mapping(address => uint256) nonces;
    mapping(address => bytes32) ticketCommitments;

    function commitToWithdrawal(
        // Called by Bob, with the ticket.receiver = Alice. He is commiting to an L1 withdrawal
        WithdrawalTicket calldata ticket,
        Signature calldata ticketSignature
    ) public {
        require(
            ticket.nonce == nonces[ticket.sender] + 1,
            "The ticket must use the next nonce."
        );

        bytes32 ticketHash = keccak256(abi.encode(ticket));
        address ticketSigner = recoverSigner(ticketHash, ticketSignature);

        require(
            ticket.sender == ticketSigner,
            "The ticket must be signed by the sender."
        );

        nonces[ticket.sender]++;
        ticketCommitments[ticket.sender] = ticketHash;
    }

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
            ticketCommitments[commitedTicket.sender] == commitedHash,
            "The ticket must be commited to"
        );

        require(
            commitedTicket.nonce == secondTicket.nonce,
            "The two tickets must have the same nonce."
        );

        EscrowEntry memory entry = escrowEntries[msg.sender];

        require(
            entry.escrowHash == keccak256(abi.encode(escrowSecret)),
            "Invalid preimage."
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
