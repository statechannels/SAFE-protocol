export type Ticket = {
  value: number;
  nonce: number;
  receiver: string;
  sender: string;
  escrowHash: string;
};
