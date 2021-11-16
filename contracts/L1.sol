// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

struct WithdrawalTicket {
    uint256 value;
    uint256 nonce;
    address payable receiver;
    address sender;
    bytes32 escrowHash;
}

contract L1Contract {
    uint256 currentNonce = 0;
    mapping(address => uint256) balances;

    function claimTickets(
        WithdrawalTicket[] calldata tickets,
        bytes32[] calldata escrowPreimages,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint8[] calldata v
    ) public {
        for (uint256 i = 0; i < tickets.length; i++) {
            claimTicket(tickets[i], escrowPreimages[i], r[i], s[i], v[i]);
        }
    }

    function claimTicket(
        WithdrawalTicket calldata ticket,
        bytes32 escrowPreimage,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) public {
        bytes32 ticketHash = keccak256(abi.encode(ticket));
        bytes32 prefixedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", ticketHash)
        );
        address ticketSigner = ecrecover(prefixedHash, v, r, s);

        bytes32 escrowHash = keccak256(abi.encode(escrowPreimage));
        require(
            escrowHash == ticket.escrowHash,
            "The preimage must match the escrow hash on the ticket"
        );

        require(
            ticket.nonce == currentNonce + 1,
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

        currentNonce++;
        ticket.receiver.transfer(ticket.value);
    }

    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }
}
