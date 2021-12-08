import { RegisteredSwapStruct } from "../contract-types/L1";

export type Ticket = {
  value: number;
  senderNonce: number;
  receiver: string;
  sender: string;
  escrowHash: string;
  expiry: number;
  token: string;
};

export type EscrowEntry = {
  receiver: string;
  sender: string;
  claimExpiry: number;
  claimStart: number;
  escrowHash: string;
  value: number;
  token: string;
};

export type SignedSwaps = {
  startIndex: number;
  swaps: RegisteredSwapStruct[];
};
