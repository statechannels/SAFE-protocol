import { RegisteredTicketStruct } from "../contract-types/L1";

export type TicketsWithIndex = {
  startIndex: number;
  tickets: RegisteredTicketStruct[];
};
