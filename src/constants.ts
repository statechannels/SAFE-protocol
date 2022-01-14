export const SIGNED_SWAPS_ABI_TYPE = [
  "tuple(uint256 startNonce, tuple(address entryRecipient, uint256 value, address token)[]) ",
];

export const USE_ERC20 = process.env.USE_ERC20 === "true";

export const ETH_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

// It is VERY important that these values match the values in
// exit.sol
export const MAX_AUTH_DELAY = 600;
export const SAFETY_DELAY = 600;
