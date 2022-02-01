import { TicketStruct } from "../contract-types/ToChain";

export type TicketsWithNonce = {
  startNonce: number;
  tickets: TicketStruct[];
};
