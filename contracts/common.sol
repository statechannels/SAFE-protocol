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
