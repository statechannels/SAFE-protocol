// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

contract L1Contract {
    /// This is a record of the highest nonce per sender.
    mapping(address => uint256) senderNonces;
    /// This is a record of funds  allocated to different senders.
    mapping(address => uint256) balances;

    /// Claims multiple tickets.
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
        require(block.timestamp <= ticket.expiry, "The ticket is expired");
        bytes32 ticketHash = keccak256(abi.encode(ticket));
        bytes32 prefixedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", ticketHash)
        );
        address ticketSigner = ecrecover(
            prefixedHash,
            signature.v,
            signature.r,
            signature.s
        );

        bytes32 escrowHash = keccak256(abi.encode(escrowPreimage));
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

        senderNonces[ticket.sender]++;
        ticket.receiver.transfer(ticket.value);
        // TODO: Underflow check?
        balances[ticket.sender] -= ticket.value;
    }

    function deposit() public payable {
        // TODO: Overflow check?
        balances[msg.sender] += msg.value;
    }
}
