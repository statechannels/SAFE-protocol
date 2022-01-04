// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

address constant lpAddress = address(
    0x9552ceB4e6FA8c356c1A76A8Bc8b1EFA7B9fb205
);

struct L1Ticket {
    /// Who will get the funds if executed
    address l1Recipient;
    /// The amount of funds to send.
    uint256 value;
    /// The address of the ERC20 token to use. If set to 0, then ETH is used.
    address token;
}

struct Ticket {
    /// Who will get the funds if executed
    address l1Recipient;
    /// The amount of funds to send.
    uint256 value;
    /// The timestamp when the ticket was registered
    uint256 createdAt;
    /// The address of the ERC20 token to use. If set to 0, then ETH is used.
    address token;
}

struct TicketsWithNonce {
    uint256 startNonce;
    L1Ticket[] tickets;
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

    function ticketsEqual(L1Ticket memory t1, L1Ticket memory t2)
        public
        pure
        returns (bool)
    {
        return (t1.value == t2.value) && (t1.l1Recipient == t2.l1Recipient);
    }
}

abstract contract FundsSender {
    // This is based on https://solidity-by-example.org/sending-ether/
    function send(
        address receiver,
        uint256 value,
        address tokenAddress
    ) public {
        if (tokenAddress == address(0)) {
            (bool sent, ) = receiver.call{value: value}("");
            require(sent, "Failed to send Ether");
        } else {
            IERC20 tokenContract = IERC20(tokenAddress);
            tokenContract.transfer(receiver, value);
        }
    }
}
