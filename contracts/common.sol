// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct ToChainTicket {
    /// Who will get the funds if executed
    address toChainRecipient;
    /// The amount of funds to send.
    uint256 value;
    /// The address of the ERC20 token to use.
    address token;
}

struct Ticket {
    /// Who will get the funds if executed
    address toChainRecipient;
    /// The amount of funds to send.
    uint256 value;
    /// The timestamp when the ticket was registered
    uint256 createdAt;
    /// The address of the ERC20 token to use.
    address token;
}

struct TicketsWithNonce {
    uint256 startNonce;
    ToChainTicket[] tickets;
}

struct Signature {
    bytes32 r;
    bytes32 s;
    uint8 v;
}

abstract contract SignatureChecker {
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

    function ticketsEqual(ToChainTicket memory t1, ToChainTicket memory t2)
        public
        pure
        returns (bool)
    {
        return
            (t1.value == t2.value) &&
            (t1.toChainRecipient == t2.toChainRecipient);
    }
}
