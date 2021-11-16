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

contract L1Contract {
    mapping(address => uint256) nonces;
    mapping(address => uint256) balances;

    function claimTickets(
        WithdrawalTicket[] calldata tickets,
        bytes32[] calldata escrowPreimages,
        Signature[] calldata signatures
    ) public {
        for (uint256 i = 0; i < tickets.length; i++) {
            claimTicket(tickets[i], escrowPreimages[i], signatures[i]);
        }
    }

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

        require(
            ticket.nonce == nonces[ticket.sender] + 1,
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

        nonces[ticket.sender]++;
        ticket.receiver.transfer(ticket.value);
    }

    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }

    // Q: How does someone recover their funds to themselves?
    // A: they can just sign a ticket with themselves as sender and reciever
    // Q: But this means they can pull their funds out at any time! They aren't truly locked?
    //    They can send to any other account they control, too?
    //    HOWEVER: the nonce protects people. The only way to yank the funds is to reuse a nonce.
    //    Alice will not unlock her payment to Bob on L2 unless she sees Bob commit to them on L2.
    //    The commitment by Bob on L2 gives Alice protection. If her L1.claimTicket tx reverts with "Ticket nonce must be the next available nonce"
    //    She must immediately go back to L2 with her ticket, and the fraudulent ticket (previously submitted to L1). She calls L2.proveFraud(ticket1,ticket2) which releases
    //    her l2 funds back to her.
    //    The timeouts must protect her, too. It cannot be possible for Bob to get the L2 funds until she has had time to claim
    //    her L1 funds, spot the failure, and come back to L2 to cancel the payment.
}
