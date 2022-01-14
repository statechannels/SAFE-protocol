import { TicketStruct } from "../contract-types/EntryChain";

export type TicketsWithNonce = {
  startNonce: number;
  tickets: TicketStruct[];
};
