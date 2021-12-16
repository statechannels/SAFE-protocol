// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

address constant lpAddress = address(
    0x9552ceB4e6FA8c356c1A76A8Bc8b1EFA7B9fb205
);

struct Ticket {
    /// Who will get the funds if executed
    address l1Recipient;
    /// The amount of funds to send.
    uint256 value;
    /// The timestamp when the ticket was registered
    uint256 createdAt;
}

struct TicketsWithIndex {
    uint256 startIndex;
    Ticket[] tickets;
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
}
