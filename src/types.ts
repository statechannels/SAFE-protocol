export type Ticket = {
  value: number;
  senderNonce: number;
  receiver: string;
  sender: string;
  escrowHash: string;
  expiry: number;
};
