import { TicketStruct } from "../contract-types/L1";

export type TicketsWithNonce = {
  startNonce: number;
  tickets: TicketStruct[];
};
