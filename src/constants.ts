export const SIGNED_SWAPS_ABI_TYPE = [
  "tuple(uint256 startNonce, tuple(address l1Recipient, uint256 value, uint256 createdAt)[]) ",
];

export const USE_ERC20 = process.env.USE_ERC20 === "true";

export const ETH_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

// It is VERY important that these values match the values in
// l2.sol
export const MAX_AUTH_DELAY = 60
export const SAFETY_DELAY = 60