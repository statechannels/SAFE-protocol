// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct Signature {
    bytes32 r;
    bytes32 s;
    uint8 v;
}

/// This represents a request to move ETH on L1 from sender to receiver.
struct WithdrawalTicket {
    /// The amount of value to be transferred.
    uint256 value;
    /// Every ticket with a sender should have a unique nonce.
    uint256 senderNonce;
    /// The address that will receive the funds.
    address payable receiver;
    /// The address the funds are being sent on behalf of.
    address sender;
    /// The hash for the funds locked in escrow for this ticket.
    bytes32 escrowHash;
    /// The expiry date for this ticket. After this date the ticket can no longer be redeemed.
    uint256 expiry;
    /// The address of an ERC20 contract, if 0 we assume the native currency
    address token;
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
