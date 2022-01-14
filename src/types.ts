import { TicketStruct } from "../contract-types/Entry";

export type TicketsWithNonce = {
  startNonce: number;
  tickets: TicketStruct[];
};
