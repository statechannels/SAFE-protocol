// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

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
    uint256 nonce;
    /// The address that will receive the funds.
    address payable receiver;
    /// The address the funds are being sent on behalf of.
    address sender;
    /// The hash for the funds locked in escrow for this ticket.
    bytes32 escrowHash;
    /// The address of an ERC20 contract, if 0 we assume the native currency
    address token;
}
