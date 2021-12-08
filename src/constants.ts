export const TICKET_ABI_TYPE = [
  "tuple(uint256 senderNonce,uint256 value,address receiver, address sender, bytes32 escrowHash, uint256 expiry, address token)",
];

export const ESCROW_ABI_TYPE = [
  "tuple(address receiver, address sender, uint256 value, uint256 claimStart, uint256 claimExpiry, bytes32 escrowHash)",
];

export const SIGNED_SWAPS_ABI_TYPE = [
  "tuple(uint256 startIndex, tuple(address l1Recipient, uint256 value, uint256 timestamp)[]) ",
];

export const ALICE_PK =
  "0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97";
export const BOB_PK =
  "0xf3d5b8ba24833578a22960b2c7a8be1ebb7907ffe0b346111b8839e981b28b0c";

export const USE_ERC20 = process.env.USE_ERC20 === "true";

export const ETH_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";
