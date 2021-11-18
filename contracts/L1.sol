// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract L1Contract {
    /// This is a record of the highest nonce per sender.
    mapping(address => uint256) nonces;
    /// This is the amount of tokens(or native currency) allocated to senders.
    // It is indexed by sender address then token address.
    mapping(address => mapping(address => uint256)) balances;

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

        require(
            ticket.nonce == nonces[ticket.sender] + 1,
            "Ticket nonce must be the next available nonce"
        );

        require(
            ticketSigner == ticket.sender,
            "Ticket is not signed by sender"
        );
        require(
            balances[ticket.sender][ticket.token] >= ticket.value,
            "Sender does not have enough funds"
        );

        nonces[ticket.sender]++;
        if (ticket.token != address(0)) {
            IERC20 token = IERC20(ticket.token);

            token.transferFrom(ticket.sender, ticket.receiver, ticket.value);
        } else {
            ticket.receiver.transfer(ticket.value);
        }

        balances[msg.sender][ticket.token] -= ticket.value;
    }

    function depositEth() public payable {
        balances[msg.sender][address(0)] += msg.value;
    }

    function depositToken(address token, uint256 amount) public {
        require(token != address(0), "Token must not be the ETH_TOKEN_ADDRESS");

        IERC20 tokenContract = IERC20(token);
        tokenContract.transferFrom(msg.sender, address(this), amount);

        balances[msg.sender][token] += amount;
    }
}
