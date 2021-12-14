import { TicketStruct } from "../contract-types/L1";

export type TicketsWithIndex = {
  startIndex: number;
  tickets: TicketStruct[];
};
