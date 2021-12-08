import { RegisteredSwapStruct } from "../contract-types/L1";

export type SwapsWithIndex = {
  startIndex: number;
  swaps: RegisteredSwapStruct[];
};
