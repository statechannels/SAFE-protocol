import { RegisteredSwapStruct } from "../contract-types/L1";

export type SignedSwaps = {
  startIndex: number;
  swaps: RegisteredSwapStruct[];
};
