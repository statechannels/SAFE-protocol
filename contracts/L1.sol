// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./common.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract L1Contract is SignatureChecker, FundsSender {
    /// A record of the current nonce per sender.
    mapping(address => uint256) senderNonces;
    /// This is the amount of tokens(or native currency) allocated to senders.
    /// Indexed by sender address then token address.
    mapping(address => mapping(address => uint256)) balances;

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
    /// Transfers funds from Bob to Alice on L1.
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
            balances[ticket.sender][ticket.token] >= ticket.value,
            "Sender does not have enough funds"
        );

        // EFFECTS
        senderNonces[ticket.sender]++;
        send(ticket.receiver, ticket.value, ticket.token);
        balances[ticket.sender][ticket.token] -= ticket.value;
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
