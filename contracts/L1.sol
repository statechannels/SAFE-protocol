// SPDX-License-Identifier: MIT
pragma solidity ^0.8.3;

struct WithdrawalTicket {
    uint256 value;
    uint256 nonce;
    address payable receiver;
    address sender;
    bytes32 escrowHash;
}

contract L1Contract {
    uint256 currentNonce = 0;
    mapping(address => uint256) private balances;

    function claimTicket(
        WithdrawalTicket calldata ticket,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) public {
        require(ticket.nonce > currentNonce, "Ticket nonce is too low");
        bytes32 ticketHash = keccak256(abi.encode(ticket));
        require(
            ecrecover(ticketHash, v, r, s) == ticket.sender,
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
