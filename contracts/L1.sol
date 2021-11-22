// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";

contract L1Contract {
    /// This is a set of accounting records for each liquidity provider
    mapping(address => Provider) providers;

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
        
        // "register" the skipped nonce
        if (ticket.delinquentValue > 0) {
            // set aside outstanding balance for missing nonce
            providers[ticket.sender].outstanding[
                providers[ticket.sender].nonce
            ] = ticket.delinquentValue;
            // reduce the 'global' balance by the same
            providers[ticket.sender].balance -= ticket.delinquentValue;
            // skip this nonce
            providers[ticket.sender].nonce++;
        }

        require(
            ticketSigner == ticket.sender,
            "Ticket is not signed by sender"
        );
        require(
            // todo: OR ticken.nonce is in providers[tiken.sender].outstanding
            ticket.nonce == providers[ticket.sender].nonce + 1,
            "Ticket nonce must be the next available nonce"
        );
        require(
            // todo: OR tocket.value === providers[ticket.sender][ticket.reciever]
            providers[ticket.sender].balance >= ticket.value,
            "Sender does not have enough funds"
        );

        providers[ticket.sender].nonce++;
        ticket.receiver.transfer(ticket.value);
        // TODO: Underflow check?
        providers[ticket.sender].balance -= ticket.value;
    }

    function deposit() public payable {
        // TODO: Overflow check?
        providers[msg.sender].balance += msg.value;
    }
}
