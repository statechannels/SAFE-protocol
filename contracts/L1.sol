// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

contract L1Contract is SignatureChecker {
    /// A record of the current nonce per sender.
    mapping(address => uint256) senderNonces;
    /// A record of funds allocated to different senders.
    mapping(address => uint256) balances;

    /// Claims multiple tickets.
    /// Batches multiple transfers into a single transaction.
    function claimTickets(
        WithdrawalTicket[] calldata tickets,
        bytes32[] calldata escrowPreimages,
        Signature[] calldata signatures
    ) public {
        for (uint256 i = 0; i < tickets.length; i++) {
            claimTicket(tickets[i], escrowPreimages[i], signatures[i]);
        }
    }

    /// Claims a single ticket.
    /// If the ticket, escrowPreimage, and signature are valid, the funds are transferred to the receiver.
    function claimTicket(
        WithdrawalTicket calldata ticket,
        bytes32 escrowPreimage,
        Signature calldata signature
    ) public {
        bytes32 ticketHash = keccak256(abi.encode(ticket));
        address ticketSigner = recoverSigner(ticketHash, signature);
        bytes32 escrowHash = keccak256(abi.encode(escrowPreimage));

        // CHECKS
        require(block.timestamp <= ticket.expiry, "The ticket is expired");

        require(
            escrowHash == ticket.escrowHash,
            "The preimage must match the escrow hash on the ticket"
        );

        require(
            ticket.senderNonce == senderNonces[ticket.sender],
            "Ticket nonce must be the next available nonce"
        );

        require(
            ticketSigner == ticket.sender,
            "Ticket is not signed by sender"
        );
        require(
            balances[ticket.sender] >= ticket.value,
            "Sender does not have enough funds"
        );

        // EFFECTS
        senderNonces[ticket.sender]++;
        ticket.receiver.transfer(ticket.value);
        balances[ticket.sender] -= ticket.value;
    }

    function deposit() public payable {
        // EFFECTS
        balances[msg.sender] += msg.value;
    }
}
