export type Ticket = {
  value: number;
  senderNonce: number;
  receiver: string;
  sender: string;
  escrowHash: string;
  expiry: number;
};

export type EscrowEntry = {
  receiver: string;
  sender: string;
  claimExpiry: number;
  claimStart: number;
  escrowHash: string;
  value: number;
};
